# Security Policy

COMPASS Interactive welcomes good-faith vulnerability reports. This policy is
the public reporting and safe-harbor policy. The system security architecture
and internal control contract are documented separately in
[`docs/SECURITY.md`](../docs/SECURITY.md).

## Supported versions

Security fixes are evaluated against the latest commit on the default branch
and the currently identified production release. Historical branches,
unsupported local modifications, expired artifacts, and third-party forks are
not supported, although a report is welcome when it demonstrates an impact on
a supported version.

## Report privately

Do not disclose a suspected vulnerability in a public issue, discussion, pull
request, social post, screenshot, video, or test artifact.

1. Use **Security > Advisories > Report a vulnerability** in this repository.
2. Include the affected commit or release, component, impact, minimal
   reproduction, and a remediation suggestion when available.
3. Remove credentials, tokens, personal data, lecture content, and unnecessary
   exploit output. Use placeholders and hashes where possible.

If private vulnerability reporting is temporarily unavailable, open a public
issue titled `Private security contact requested` without vulnerability details.
A maintainer will provide a private channel. Never place a secret or exploit in
that issue.

## Response targets

These are service targets, not a promise of a particular fix or reward:

- acknowledgement within five business days;
- initial severity and scope assessment within ten business days; and
- a status update at least every fourteen days while an accepted report remains
  unresolved.

We may close duplicates, non-security defects, unsupported-version reports, or
reports that do not demonstrate security impact. We will coordinate disclosure
timing for a validated issue and credit the reporter with permission.

## In scope

Examples include:

- authentication, authorization, session, MFA, or privilege-boundary failures;
- cross-user, cross-lecture, or cross-environment data access;
- RLS, RPC, Edge Function, Worker, PDF, archive, or Presenter access-control
  failures;
- exposure of credentials, private lecture material, or personal data;
- exploitable XSS, CSRF, SSRF, injection, request smuggling, or unsafe redirect;
- paid-operation, budget, concurrency, idempotency, or post-close bypasses;
- dependency or CI/CD compromise that affects a supported version; and
- a reproducible vulnerability in the repository's own code or configuration.

## Research rules

Use the local `/demo` route, a local Supabase stack, or an environment that you
own and control. Use synthetic data and accounts created for your testing.

Passive observation of the public production application is allowed. Active
production testing requires separate written authorization from the maintainer.
This policy does not authorize you to:

- access, alter, download, retain, or disclose another person's data;
- test credentials, lecture codes, MFA factors, invitations, or sessions that
  you do not own;
- perform denial of service, stress testing, automated brute force, destructive
  testing, persistence, phishing, or social engineering;
- trigger paid AI, email, storage, compute, or other metered operations without
  written authorization;
- upload malware, unlawful material, or sensitive personal information;
- degrade a lecture, classroom display, archive, or production service;
- publicly disclose an unresolved vulnerability; or
- test GitHub, Supabase, Cloudflare, OpenAI, Google, or another third party's
  infrastructure under this policy.

If you encounter credentials, authenticated browser state, personal data,
private lecture content, or production data, stop immediately, do not copy or
retain it, and report the minimum information needed for containment.

## Safe harbor

When you make a good-faith effort to follow this policy, use only the minimum
access necessary, avoid privacy and service impact, and report promptly through
the private channel, the project will treat your research as authorized for the
limited purpose of this policy. The project will not initiate or support legal
action against you for an accidental, good-faith violation that you promptly
report and remediate.

This safe harbor does not waive third-party rights, bind service providers, or
authorize conduct outside the scope above. If you are uncertain whether a test
is permitted, ask through the private reporting channel before proceeding.

## Rewards and disclosure

There is currently no standing bug-bounty or payment program. A report does not
create a right to compensation. Public disclosure, advisory publication, CVE
coordination, and reporter credit will be agreed case by case after affected
users and systems are protected.
