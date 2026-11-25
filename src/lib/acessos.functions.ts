import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ManagedUser = {
  id: string;
  email: string;
  created_at: string;
  is_admin: boolean;
  permissions: string[];
  client_id: string | null;
  display_name: string | null;
};

/**
 * Admin = tem o papel "admin" em user_roles. Consulta com a chave de serviço,
 * só para o próprio usuário logado (o id vem do token já validado).
 * Não existe mais o "modo inicial" (sem nenhum admin, qualquer um virava
 * admin): já há administradores cadastrados e isso abria brecha.
 */
async function isEffectiveAdmin(_supabase: any, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function assertEffectiveAdmin(supabase: any, userId: string) {
  if (!(await isEffectiveAdmin(supabase, userId))) {
    throw new Error("Acesso negado: apenas administradores.");
  }
}

export const listManagedUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ users: ManagedUser[]; bootstrap: boolean }> => {
    await assertEffectiveAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new Error(error.message);
    const [{ data: roles }, { data: perms }, { data: links }, { data: profiles }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id,role"),
      supabaseAdmin.from("user_permissions").select("user_id,module"),
      supabaseAdmin.from("user_clients").select("user_id,client_id"),
      supabaseAdmin.from("user_profiles").select("user_id,display_name"),
    ]);
    const adminSet = new Set((roles ?? []).filter((r: any) => r.role === "admin").map((r: any) => r.user_id));
    const permMap = new Map<string, string[]>();
    (perms ?? []).forEach((p: any) => {
      const arr = permMap.get(p.user_id) ?? [];
      arr.push(p.module);
      permMap.set(p.user_id, arr);
    });
    const clientMap = new Map<string, string>();
    (links ?? []).forEach((l: any) => clientMap.set(l.user_id, l.client_id));
    const users: ManagedUser[] = list.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      is_admin: adminSet.has(u.id),
      permissions: permMap.get(u.id) ?? [],
      client_id: clientMap.get(u.id) ?? null,
      display_name: profiles?.find((p: any) => p.user_id === u.id)?.display_name ?? null,
    }));
    return { users, bootstrap: false };
  });

export const createManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; password: string; is_admin: boolean; permissions: string[]; client_id?: string | null; display_name?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertEffectiveAdmin(context.supabase, context.userId);
    if (!data.email || !data.password || data.password.length < 6) {
      throw new Error("Informe email e senha (mínimo 6 caracteres).");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim(),
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "Falha ao criar usuário.");
    const uid = created.user.id;
    if (data.is_admin) {
      await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "admin" });
    }
    if (data.permissions.length) {
      await supabaseAdmin.from("user_permissions").insert(
        data.permissions.map((m) => ({ user_id: uid, module: m })),
      );
    }
    if (data.client_id) {
      await supabaseAdmin.from("user_clients").insert({ user_id: uid, client_id: data.client_id });
    }
    if (data.display_name?.trim()) {
      await supabaseAdmin.from("user_profiles").insert({ user_id: uid, display_name: data.display_name.trim() });
    }
    return { id: uid };
  });

export const updateManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; is_admin: boolean; permissions: string[]; password?: string; client_id?: string | null; display_name?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertEffectiveAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.password && data.password.length >= 6) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
      if (error) throw new Error(error.message);
    }

    // sync admin role
    if (data.is_admin) {
      await supabaseAdmin.from("user_roles").upsert({ user_id: data.user_id, role: "admin" }, { onConflict: "user_id,role" });
    } else {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id).eq("role", "admin");
    }

    // sync permissions (replace)
    await supabaseAdmin.from("user_permissions").delete().eq("user_id", data.user_id);
    if (data.permissions.length) {
      await supabaseAdmin.from("user_permissions").insert(
        data.permissions.map((m) => ({ user_id: data.user_id, module: m })),
      );
    }

    // sync client link (one per user)
    await supabaseAdmin.from("user_clients").delete().eq("user_id", data.user_id);
    if (data.client_id) {
      await supabaseAdmin.from("user_clients").insert({ user_id: data.user_id, client_id: data.client_id });
    }
    
    if (data.display_name !== undefined) {
      if (data.display_name.trim()) {
        await supabaseAdmin.from("user_profiles").upsert({ user_id: data.user_id, display_name: data.display_name.trim() }, { onConflict: "user_id" });
      } else {
        await supabaseAdmin.from("user_profiles").delete().eq("user_id", data.user_id);
      }
    }

    return { ok: true };
  });

export const deleteManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertEffectiveAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("Você não pode excluir sua própria conta.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const changeMyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { password: string }) => d)
  .handler(async ({ data, context }) => {
    if (data.password.length < 6) throw new Error("A senha deve ter no mínimo 6 caracteres.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, { password: data.password });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [rolesRes, permsRes, linkRes, profileRes] = await Promise.all([
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      context.supabase.from("user_permissions").select("module").eq("user_id", context.userId),
      context.supabase.from("user_clients").select("client_id").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("user_profiles").select("display_name").eq("user_id", context.userId).maybeSingle(),
    ]);

    const is_admin = (rolesRes.data ?? []).some((r: any) => r.role === "admin");

    return {
      is_admin,
      bootstrap: false,
      effective_admin: is_admin,
      permissions: (permsRes.data ?? []).map((p: any) => p.module as string),
      client_id: (linkRes.data as any)?.client_id ?? null,
      display_name: (profileRes.data as any)?.display_name ?? null,
    };
  });