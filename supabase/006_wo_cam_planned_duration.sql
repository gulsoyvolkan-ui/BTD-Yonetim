-- İş emri CAM: planlı tezgâh + süre (dk)
ALTER TABLE public.is_emri_cam_adimlari ADD COLUMN IF NOT EXISTS planlanan_makine TEXT;
ALTER TABLE public.is_emri_cam_adimlari ADD COLUMN IF NOT EXISTS sure_dk NUMERIC;
