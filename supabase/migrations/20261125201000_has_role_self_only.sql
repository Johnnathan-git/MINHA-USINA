-- has_role só responde sobre o próprio usuário logado (ou para o servidor com
-- a chave de serviço). Antes qualquer usuário logado podia perguntar se outra
-- pessoa era admin. As regras de acesso sempre chamam has_role(auth.uid(), ...).
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (_user_id = auth.uid() or auth.role() = 'service_role')
    and exists (
      select 1
      from public.user_roles
      where user_id = _user_id
        and role = _role
    )
$function$;
