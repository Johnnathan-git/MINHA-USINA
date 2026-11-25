-- Segurança: leitura restrita (antes qualquer usuário logado — inclusive
-- clientes com acesso só ao relatório — podia ler estas tabelas inteiras).
-- Admin continua vendo tudo; o cliente só vê o próprio perfil.

DROP POLICY IF EXISTS client_allocations_select ON public.client_allocations;
CREATE POLICY client_allocations_select ON public.client_allocations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS inventory_assets_select ON public.inventory_assets;
CREATE POLICY inventory_assets_select ON public.inventory_assets
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS investment_expenses_select ON public.investment_expenses;
CREATE POLICY investment_expenses_select ON public.investment_expenses
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS plant_config_select ON public.plant_config;
CREATE POLICY plant_config_select ON public.plant_config
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Allow public read for categories" ON public.transaction_categories;
DROP POLICY IF EXISTS transaction_categories_select ON public.transaction_categories;
CREATE POLICY transaction_categories_select ON public.transaction_categories
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
CREATE POLICY "Users can view their own profile" ON public.user_profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
