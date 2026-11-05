-- Development testing: sign-up works for synthetic accounts only. example.com is reserved by RFC 2606,
-- so nobody can have a real mailbox there. Real addresses stay refused until the owner approves public registration.
insert into private.allowed_signup_patterns (pattern, note)
values ('%@example.com', 'Synthetic development test accounts (reserved domain)');
