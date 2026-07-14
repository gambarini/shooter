.PHONY: serve
serve:
	@echo "NEON STRIKE → http://localhost:8000  (Ctrl+C to stop)"
	@python3 -m http.server 8000
