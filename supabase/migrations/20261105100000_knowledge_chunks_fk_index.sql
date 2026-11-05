-- Index untuk foreign key komposit (source_id, bot_id): mempercepat hapus sumber (cascade).
create index if not exists knowledge_chunks_source_bot_idx on public.knowledge_chunks (source_id, bot_id);
