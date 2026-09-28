SHELL := /bin/bash
.DEFAULT_GOAL := help

NODE      ?= node
NPX       ?= npx
CSS_IN    := src/styles/input.css
CSS_OUT   := dist/assets/site.css

.PHONY: help dev build css lint format typecheck check-content check-links test ci smoke clean

help: ## list targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{ printf "  %-14s %s\n", $$1, $$2 }'

dev: css ## build (unhashed assets), then watch CSS and run the server with --watch (reads .env)
	$(NODE) --env-file-if-exists=.env scripts/build.js --dev
	@trap 'kill 0' EXIT; \
	$(NPX) @tailwindcss/cli -i $(CSS_IN) -o $(CSS_OUT) --watch=always & \
	$(NODE) --env-file-if-exists=.env --watch src/server.js

css: ## Tailwind v4 → dist/assets/site.css
	$(NPX) @tailwindcss/cli -i $(CSS_IN) -o $(CSS_OUT) --minify

build: css ## css + render every page into dist/ (SITE_URL from the environment or .env)
	$(NODE) --env-file-if-exists=.env scripts/build.js

lint: ## eslint + prettier --check
	$(NPX) eslint .
	$(NPX) prettier --check .

format: ## prettier --write
	$(NPX) prettier --write .

typecheck: ## tsc --checkJs --noEmit
	$(NPX) tsc -p tsconfig.json

check-content: ## frontmatter schema, unique slugs, image sizes, bot-path guard
	$(NODE) scripts/check-content.js

check-links: ## every internal href in dist/ resolves
	$(NODE) scripts/check-links.js

test: ## node --test
	$(NODE) --test

html-validate: ## validate the built pages (run after build)
	$(NPX) html-validate "dist/**/*.html"

ci: lint typecheck check-content test build html-validate check-links smoke ## everything CI runs

smoke: ## build the image if docker is available, run it, curl every page, contact flow with n8n down
	$(NODE) scripts/smoke.js

clean:
	rm -rf dist
