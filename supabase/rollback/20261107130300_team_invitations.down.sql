-- Rolls back 20261107130300_team_invitations. Run as postgres, in one transaction, only after the later migrations are rolled back.
-- LOCAL REHEARSAL so far. Not to be run on a hosted project without the owner's explicit approval.
-- Invitations made through this migration have no token, so they go. People who already accepted stay members.
drop function public.invite_organization_member(uuid, text, public.org_role);
drop function public.organization_team(uuid);
drop function public.my_organization_invitations();
drop function public.accept_organization_invitation(uuid);
drop function public.decline_organization_invitation(uuid);
drop index public.organization_invitations_one_open;
delete from public.organization_invitations where token_hash is null;
alter table public.organization_invitations alter column token_hash set not null;
