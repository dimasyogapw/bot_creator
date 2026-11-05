-- Pengetatan: fungsi rahasia skill hanya bisa dipanggil server (secret key), tidak oleh akun yang login.
-- Server memeriksa kepemilikan skill lewat RLS sebelum memanggilnya.
revoke execute on function public.can_manage_skill(uuid) from authenticated;
revoke execute on function public.set_skill_secret(uuid, text, text) from authenticated;
revoke execute on function public.delete_skill_secret(uuid, text) from authenticated;
revoke execute on function public.get_skill_secrets(uuid) from authenticated;
