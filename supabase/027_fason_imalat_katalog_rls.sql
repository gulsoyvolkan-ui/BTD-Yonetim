-- Fason imalat kataloğu: RLS kapanışı.
-- Eski 016 demo_all_access ve anon GRANT bu dosyada yok.
-- 024 tabloyu açar. 009–019 güvenlik dosyalarının yerine geçmez.

ALTER TABLE public.fason_imalat_katalogu ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_all_access ON public.fason_imalat_katalogu;
REVOKE ALL ON TABLE public.fason_imalat_katalogu FROM PUBLIC, anon;
