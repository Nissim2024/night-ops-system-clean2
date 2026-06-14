# NightOps Deployment — Makefile
# Usage: make <target> [VERSION=v2.x.x]

VERSION ?= $(shell git describe --tags --abbrev=0 2>/dev/null || echo "v2.2.0")
SCRIPTS  = ./scripts

.PHONY: help install deploy switch rollback migrate backup health status

help:
	@echo ""
	@echo "  NightOps Blue/Green Deployment"
	@echo "  VERSION=$(VERSION)"
	@echo ""
	@echo "  make install   VERSION=v2.2.0   התקנה ראשונית"
	@echo "  make deploy    VERSION=v2.3.0   deploy גרסה חדשה ל-Green"
	@echo "  make switch                     העבר traffic ל-Green"
	@echo "  make rollback                   חזור ל-Blue מיד"
	@echo "  make migrate   VERSION=v2.3.0   הרץ DB migrations"
	@echo "  make backup    VERSION=v2.3.0   גיבוי DB"
	@echo "  make health    SLOT=green        בדוק בריאות slot"
	@echo "  make status                     מצב נוכחי"
	@echo ""

install:
	bash $(SCRIPTS)/initial_deploy.sh $(VERSION)

deploy:
	bash $(SCRIPTS)/deploy_green.sh $(VERSION)

switch:
	bash $(SCRIPTS)/switch_traffic.sh

rollback:
	bash $(SCRIPTS)/rollback.sh "ידני דרך make rollback"

migrate:
	bash $(SCRIPTS)/migrate.sh $(VERSION)

backup:
	bash $(SCRIPTS)/backup.sh $(VERSION)

health:
	bash $(SCRIPTS)/healthcheck.sh $(SLOT)

status:
	@echo ""
	@echo "=== Active Slot ==="
	@cat /opt/nightops/state/active_slot 2>/dev/null || echo "unknown"
	@echo ""
	@echo "=== Running Containers ==="
	@docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" \
	  --filter "name=nightops" 2>/dev/null || echo "docker not available"
	@echo ""
	@echo "=== Nginx Upstream ==="
	@cat /etc/nginx/conf.d/nightops-upstream.conf 2>/dev/null || echo "nginx not configured"
	@echo ""
