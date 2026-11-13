dev:
docker compose up

migrate:
supabase db push

seed:
supabase db reset && npm run seed

test:
npm test

deploy:
wrangler deploy && supabase functions deploy
