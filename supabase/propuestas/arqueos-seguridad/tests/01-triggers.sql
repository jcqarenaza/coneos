CREATE TRIGGER bump_catalogo AFTER INSERT OR DELETE OR UPDATE ON public.presentaciones FOR EACH ROW EXECUTE FUNCTION trg_bump_catalogo();
CREATE TRIGGER bump_catalogo AFTER INSERT OR DELETE OR UPDATE ON public.producto_stock FOR EACH ROW EXECUTE FUNCTION trg_bump_catalogo();
