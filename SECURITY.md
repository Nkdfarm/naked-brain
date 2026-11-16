# Security

Naked Brain is the phone app of the FarmBox Operations Platform. If you find a security problem in it — a way to read
or change a farm's data without being allowed to, a key or password in the code, anything that puts the people who use
it at risk — please do not open a public issue.

Report it privately: **Security › Report a vulnerability** on this repository (GitHub's private vulnerability
reporting). You will get an answer within a few days.

The app holds no secret: the Supabase key in it is the public "anon" key, which the database's row-level security and
the edge functions' own checks are built to withstand. Notion and Groq are reached through a gateway that holds their keys.
