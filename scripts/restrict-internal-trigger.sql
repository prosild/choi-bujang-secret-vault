-- Internal event trigger remains installed; clients cannot call it as an RPC.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
