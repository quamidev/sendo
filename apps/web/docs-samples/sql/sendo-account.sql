-- Alternative to `npx @quami/sendo accounts add`. token_ref is the env var NAME.
insert into public.sendo_accounts (tenant_id, phone_number_id, waba_id, display_phone, token_ref)
values (null, '123456789012345', '987654321098765', '+1 555 000 1111', 'SENDO_TOKEN_MAIN');
