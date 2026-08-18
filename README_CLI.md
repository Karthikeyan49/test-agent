# SystemIntel Platform - Pure CLI Tool Mode
This system operates 100% via the command line interface (cli.py) or REST API (backend/main.py).
UI is disabled as per configuration.

Usage:
  python3 cli.py scan --path ./src/sample_erp --sql ./src/sample_erp/schema.sql --json
  python3 cli.py test --path ./src/sample_erp --sql ./src/sample_erp/schema.sql --output report.json
  python3 cli.py query "Where is customer_id used?"
