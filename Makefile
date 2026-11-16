# Requires Node 22. `make deploy` needs Docker (for the Container image); without
# Docker, run the "Deploy apex-api Worker + Container" GitHub Action instead.

install:
	npm install

setup-db:
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f supabase/clipper-setup.sql

test:
	npm run typecheck --workspace=apps/worker
	npm test --workspace=apps/container

rls-test:
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f supabase/tests/rls_cross_tenant.sql

web:
	npm run dev --workspace=apps/web

build:
	npm run build --workspace=apps/web

deploy:
	cd apps/worker && npx wrangler deploy

sync-pocketathlete:
	node scripts/sync-pocketathlete.mjs ../FOOTBALLFITNESSGURU
