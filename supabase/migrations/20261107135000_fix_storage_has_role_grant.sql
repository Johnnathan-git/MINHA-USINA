-- Upload de anexos (bucket faturas_v3_privado_v2) estava falhando com
-- "permission denied for function has_role": as policies de storage
-- chamam public.has_role(auth.uid(), 'admin'), mas a migration
-- 20260806023910 revogou o EXECUTE da função de authenticated, deixando
-- só service_role. Devolve o EXECUTE para authenticated (como era na
-- migration 20260805000651); a checagem de admin continua dentro da função.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
