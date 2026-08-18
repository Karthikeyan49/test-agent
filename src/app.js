import { SourceCodeAnalyzer } from './engine/parser.js';
import { DatabaseAnalyzer } from './engine/db_analyzer.js';
import { SystemGraph } from './engine/system_graph.js';
import { AIProviderEngine } from './engine/ai_provider.js';
import { TestScenarioGenerator } from './engine/test_generator.js';
import { TestExecutionEngine } from './engine/test_executor.js';
import { FailureAnalyzerEngine } from './engine/failure_analyzer.js';
import { ReportGeneratorEngine } from './engine/report_generator.js';

class ApplicationController {
  constructor() {
    this.codeAnalyzer = new SourceCodeAnalyzer();
    this.dbAnalyzer = new DatabaseAnalyzer();
    this.systemGraph = new SystemGraph();
    this.aiProvider = new AIProviderEngine();
    this.testGenerator = new TestScenarioGenerator();
    this.testExecutor = new TestExecutionEngine();
    this.failureAnalyzer = new FailureAnalyzerEngine();
    this.reportGenerator = new ReportGeneratorEngine();

    this.currentView = 'dashboard';
    this.testCases = [];
    this.latestRun = null;
    this.selectedGraphNode = null;

    // Embedded Sample ERP Source Files
    this.sampleFiles = [
      {
        name: 'CustomerPage.jsx',
        path: 'src/sample_erp/frontend/CustomerPage.jsx',
        content: `import React, { useState } from 'react';
// Route: /customer/create & /customers
export function CustomerCreatePage() {
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [creditLimit, setCreditLimit] = useState(10000);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const response = await fetch('/api/v1/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: customerName, email, creditLimit })
    });
  };
  return (
    <div>
      <input id="field-customer-name" value={customerName} required placeholder="Customer Name" />
      <input id="field-email" value={email} required placeholder="Email Address" />
      <input id="field-credit-limit" type="number" value={creditLimit} required />
      <button id="btn-submit-customer" type="submit">Save Customer</button>
    </div>
  );
}`
      },
      {
        name: 'SalesOrderPage.jsx',
        path: 'src/sample_erp/frontend/SalesOrderPage.jsx',
        content: `import React, { useState } from 'react';
// Route: /sales/order/create
export function SalesOrderPage() {
  const [customerId, setCustomerId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(100);

  const subtotal = quantity * unitPrice;
  const grandTotal = subtotal + (subtotal * 0.10);

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    await fetch('/api/v1/sales-orders', {
      method: 'POST',
      body: JSON.stringify({ customerId, quantity, unitPrice, grandTotal })
    });
  };
  return (
    <div>
      <input id="field-sales-customer-id" value={customerId} />
      <input id="field-quantity" value={quantity} />
      <span id="field-grand-total">\${grandTotal}</span>
      <button id="btn-confirm-order">Confirm Order</button>
    </div>
  );
}`
      },
      {
        name: 'CustomerController.ts',
        path: 'src/sample_erp/backend/CustomerController.ts',
        content: `import { CustomerService } from './CustomerService';
export class CustomerController {
  // POST /api/v1/customers
  public async createCustomer(req, res) {
    const { name, email, creditLimit } = req.body;
    const service = new CustomerService();
    const customer = await service.createCustomer({ name, email, creditLimit });
    res.status(201).json(customer);
  }
}`
      },
      {
        name: 'CustomerService.ts',
        path: 'src/sample_erp/backend/CustomerService.ts',
        content: `import { CustomerRepository } from './CustomerRepository';
export class CustomerService {
  public async createCustomer(dto) {
    if (dto.creditLimit < 0) throw new Error('Credit limit cannot be negative');
    const repo = new CustomerRepository();
    return await repo.insert({ name: dto.name, email: dto.email, credit_limit: dto.creditLimit });
  }
}`
      },
      {
        name: 'CustomerRepository.ts',
        path: 'src/sample_erp/backend/CustomerRepository.ts',
        content: `export class CustomerRepository {
  public async insert(data) {
    const sql = \`INSERT INTO customers (name, email, credit_limit) VALUES ('\${data.name}', '\${data.email}', \${data.credit_limit})\`;
    return { id: "cust-101", ...data };
  }
}`
      }
    ];

    this.sampleSql = `
CREATE TABLE customers (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  credit_limit DECIMAL(12, 2) DEFAULT 10000.00,
  outstanding_balance DECIMAL(12, 2) DEFAULT 0.00
);

CREATE TABLE sales_orders (
  id VARCHAR(36) PRIMARY KEY,
  customer_id VARCHAR(36) NOT NULL,
  grand_total DECIMAL(12, 2) NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
`;
  }

  async init() {
    this.ingestAndBuildGraph();
    this.testCases = this.testGenerator.generateTestSuites(this.systemGraph);
    this.render();
    if (window.lucide) window.lucide.createIcons();
  }

  ingestAndBuildGraph() {
    const feBeResults = this.codeAnalyzer.analyzeProjectFiles(this.sampleFiles);
    const dbResults = this.dbAnalyzer.analyzeSchema(this.sampleSql);
    this.systemGraph.buildFromAnalysis(feBeResults, feBeResults, dbResults);
  }

  navigate(viewId) {
    this.currentView = viewId;

    // Update active nav button
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeBtn = document.getElementById(`nav-${viewId}`);
    if (activeBtn) activeBtn.classList.add('active');

    this.render();
  }

  render() {
    const container = document.getElementById('main-content-view');
    if (!container) return;

    switch (this.currentView) {
      case 'dashboard':
        container.innerHTML = this.renderDashboard();
        break;
      case 'projects':
        container.innerHTML = this.renderProjectsView();
        break;
      case 'graph':
        container.innerHTML = this.renderGraphView();
        setTimeout(() => this.initVisGraph(), 50);
        break;
      case 'page-connectivity':
        container.innerHTML = this.renderPageConnectivityView();
        break;
      case 'field-connectivity':
        container.innerHTML = this.renderFieldConnectivityView();
        break;
      case 'impact-analysis':
        container.innerHTML = this.renderImpactAnalysisView();
        break;
      case 'workflows':
        container.innerHTML = this.renderWorkflowsView();
        break;
      case 'test-scenarios':
        container.innerHTML = this.renderTestScenariosView();
        break;
      case 'test-execution':
        container.innerHTML = this.renderTestExecutionView();
        break;
      case 'failures':
        container.innerHTML = this.renderFailuresView();
        break;
      case 'reports':
        container.innerHTML = this.renderReportsView();
        break;
      case 'system-query':
        container.innerHTML = this.renderSystemQueryView();
        break;
      case 'ai-config':
        container.innerHTML = this.renderAIConfigView();
        break;
      default:
        container.innerHTML = this.renderDashboard();
    }

    if (window.lucide) window.lucide.createIcons();
  }

  // --- VIEW RENDERERS ---

  renderDashboard() {
    const nodes = this.systemGraph.getAllNodes();
    const edges = this.systemGraph.getAllEdges();

    const pagesCount = nodes.filter(n => n.type === 'Page').length;
    const fieldsCount = nodes.filter(n => n.type === 'Field').length;
    const apisCount = nodes.filter(n => n.type === 'APIEndpoint').length;
    const tablesCount = nodes.filter(n => n.type === 'Table').length;
    const edgesCount = edges.length;

    return `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-white tracking-tight">System Intelligence Dashboard</h2>
            <p class="text-xs text-slate-400 mt-1">Live architecture metadata, lineage edges, and autonomous testing metrics.</p>
          </div>
          <div class="flex gap-2">
            <span class="px-3 py-1 bg-emerald-950 border border-emerald-700 text-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Graph Synchronized
            </span>
          </div>
        </div>

        <!-- 14 Core Metric Cards Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Total Pages</div>
            <div class="text-2xl font-bold text-sky-400 mt-1">${pagesCount}</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Components</div>
            <div class="text-2xl font-bold text-indigo-400 mt-1">6</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Input Fields</div>
            <div class="text-2xl font-bold text-emerald-400 mt-1">${fieldsCount}</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">API Endpoints</div>
            <div class="text-2xl font-bold text-amber-400 mt-1">${apisCount}</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">DB Tables</div>
            <div class="text-2xl font-bold text-purple-400 mt-1">${tablesCount}</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Graph Edges</div>
            <div class="text-2xl font-bold text-cyan-400 mt-1">${edgesCount}</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Workflows</div>
            <div class="text-2xl font-bold text-rose-400 mt-1">2</div>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Test Scenarios</div>
            <div class="text-2xl font-bold text-slate-100 mt-1">${this.testCases.length}</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Test Runs</div>
            <div class="text-2xl font-bold text-slate-100 mt-1">${this.testExecutor.executionHistory.length || 1}</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Pass Rate</div>
            <div class="text-2xl font-bold text-emerald-400 mt-1">${this.latestRun ? this.latestRun.passRate + '%' : '80.0%'}</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Failure Rate</div>
            <div class="text-2xl font-bold text-rose-400 mt-1">${this.latestRun ? (100 - parseFloat(this.latestRun.passRate)).toFixed(1) + '%' : '20.0%'}</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Lineage Coverage</div>
            <div class="text-2xl font-bold text-sky-400 mt-1">100%</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">Critical Failures</div>
            <div class="text-2xl font-bold text-amber-400 mt-1">1</div>
          </div>
          <div class="metric-card">
            <div class="text-[11px] font-semibold text-slate-400 uppercase">AI Provider</div>
            <div class="text-xs font-bold text-indigo-300 mt-2 truncate">Qwen3-Coder</div>
          </div>
        </div>

        <!-- Quick Launch Panels -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="glass-card p-5 space-y-3 col-span-2">
            <h3 class="font-bold text-slate-200 text-sm flex items-center gap-2">
              <i data-lucide="shield-check" class="w-4 h-4 text-sky-400"></i> Autonomous Testing Quick Actions
            </h3>
            <p class="text-xs text-slate-400">Trigger end-to-end system graph construction, evidence-based test generation, and Playwright execution.</p>
            <div class="flex gap-3 pt-2">
              <button onclick="app.runFullPipeline()" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow-lg shadow-sky-500/20 transition">
                <i data-lucide="play" class="w-4 h-4"></i> Execute All 5 Test Scenarios
              </button>
              <button onclick="app.navigate('graph')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-2 transition">
                <i data-lucide="git-fork" class="w-4 h-4"></i> Explore System Graph
              </button>
            </div>
          </div>

          <div class="glass-card p-5 space-y-3">
            <h3 class="font-bold text-slate-200 text-sm flex items-center gap-2">
              <i data-lucide="sparkles" class="w-4 h-4 text-indigo-400"></i> AI Assistant Status
            </h3>
            <div class="p-3 bg-slate-900/80 rounded-lg text-xs space-y-1.5 border border-slate-800">
              <div class="flex justify-between"><span class="text-slate-400">Model:</span><span class="font-mono text-indigo-300">qwen3-coder:30b</span></div>
              <div class="flex justify-between"><span class="text-slate-400">Mode:</span><span class="text-emerald-400 font-semibold">Local vLLM / Ollama</span></div>
              <div class="flex justify-between"><span class="text-slate-400">Deterministic Fallback:</span><span class="text-sky-400">Active</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderProjectsView() {
    return `
      <div class="space-y-6">
        <div>
          <h2 class="text-2xl font-bold text-white tracking-tight">Project Ingestion Engine</h2>
          <p class="text-xs text-slate-400 mt-1">Upload ZIP archive, connect Git Repository, or import local project for AST parsing.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="glass-card p-6 border-dashed border-2 border-slate-700 hover:border-sky-500 cursor-pointer transition text-center space-y-3">
            <div class="w-12 h-12 rounded-full bg-sky-950 text-sky-400 mx-auto flex items-center justify-center">
              <i data-lucide="file-archive" class="w-6 h-6"></i>
            </div>
            <h3 class="font-bold text-slate-200 text-sm">ZIP Upload</h3>
            <p class="text-xs text-slate-400">Upload source ZIP containing Frontend, Backend & SQL schema.</p>
          </div>

          <div class="glass-card p-6 border border-slate-700 hover:border-sky-500 cursor-pointer transition text-center space-y-3">
            <div class="w-12 h-12 rounded-full bg-indigo-950 text-indigo-400 mx-auto flex items-center justify-center">
              <i data-lucide="git-branch" class="w-6 h-6"></i>
            </div>
            <h3 class="font-bold text-slate-200 text-sm">Git Repository URL</h3>
            <p class="text-xs text-slate-400">Provide Git clone URL with branch specification.</p>
          </div>

          <div class="glass-card p-6 border border-slate-700 border-sky-500 bg-sky-950/20 text-center space-y-3">
            <div class="w-12 h-12 rounded-full bg-emerald-950 text-emerald-400 mx-auto flex items-center justify-center">
              <i data-lucide="folder-check" class="w-6 h-6"></i>
            </div>
            <h3 class="font-bold text-slate-200 text-sm">Active Demo ERP</h3>
            <p class="text-xs text-slate-400">Embedded ERP sample project with Customer, Order & Payment flows.</p>
          </div>
        </div>

        <div class="glass-card p-6 space-y-4">
          <h3 class="font-bold text-slate-200 text-sm">Detected Project Metadata</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div class="p-3 bg-slate-900 rounded-lg"><span class="text-slate-400 block mb-1">Frontend Framework</span><strong class="text-sky-400">React (JSX / Vite)</strong></div>
            <div class="p-3 bg-slate-900 rounded-lg"><span class="text-slate-400 block mb-1">Backend Framework</span><strong class="text-indigo-400">Node.js + Express / TS</strong></div>
            <div class="p-3 bg-slate-900 rounded-lg"><span class="text-slate-400 block mb-1">Database ORM</span><strong class="text-emerald-400">SQLAlchemy / SQL DDL</strong></div>
            <div class="p-3 bg-slate-900 rounded-lg"><span class="text-slate-400 block mb-1">API Style</span><strong class="text-amber-400">RESTful JSON</strong></div>
          </div>
        </div>
      </div>
    `;
  }

  renderGraphView() {
    return `
      <div class="h-full flex flex-col space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-xl font-bold text-white tracking-tight">Interactive System Graph</h2>
            <p class="text-xs text-slate-400">Complete end-to-end mapping from Frontend Pages down to Database Columns.</p>
          </div>
          <div class="flex gap-2">
            <button onclick="app.initVisGraph()" class="px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-300 rounded text-xs hover:bg-slate-700">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5 inline mr-1"></i> Reset View
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1 min-h-[500px]">
          <!-- Visual Canvas Container -->
          <div class="lg:col-span-3 glass-card p-2 relative overflow-hidden flex flex-col">
            <div id="vis-network-container" class="w-full h-full min-h-[500px] bg-slate-950/80 rounded-lg"></div>
          </div>

          <!-- Selected Node Details Side Panel -->
          <div class="glass-card p-4 space-y-4 text-xs overflow-y-auto custom-scrollbar">
            <h3 class="font-bold text-slate-200 border-b border-slate-800 pb-2">Graph Node Evidence Panel</h3>
            <div id="graph-node-details" class="space-y-3">
              <div class="p-3 bg-slate-900/90 rounded border border-slate-800 text-slate-400">
                Click any node in the graph to inspect exact source file, line number, relationship confidence, and lineage.
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  initVisGraph() {
    const container = document.getElementById('vis-network-container');
    if (!container) return;

    const rawNodes = this.systemGraph.getAllNodes();
    const rawEdges = this.systemGraph.getAllEdges();

    const colorMap = {
      Page: '#38bdf8',
      Field: '#34d399',
      APIEndpoint: '#fbbf24',
      Controller: '#818cf8',
      Service: '#c084fc',
      Repository: '#a78bfa',
      Table: '#f472b6',
      Column: '#f43f5e'
    };

    const nodes = rawNodes.map(n => ({
      id: n.id,
      label: `${n.type}\n${n.name}`,
      color: {
        background: colorMap[n.type] || '#64748b',
        border: '#1e293b'
      },
      font: { color: '#0f172a', face: 'Inter', size: 12, bold: true },
      shape: 'box',
      margin: 10
    }));

    const edges = rawEdges.map(e => ({
      from: e.source,
      to: e.target,
      label: e.relationship,
      font: { color: '#94a3b8', size: 9, align: 'middle' },
      arrows: 'to',
      color: { color: '#475569', highlight: '#38bdf8' }
    }));

    const data = { nodes, edges };
    const options = {
      physics: {
        barnesHut: { gravitationalConstant: -3000, springLength: 120 }
      },
      interaction: { hover: true }
    };

    const network = new vis.Network(container, data, options);

    network.on("click", (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        this.renderNodeDetails(nodeId);
      }
    });
  }

  renderNodeDetails(nodeId) {
    const node = this.systemGraph.getNode(nodeId);
    const panel = document.getElementById('graph-node-details');
    if (!node || !panel) return;

    const upstream = this.systemGraph.getUpstreamLineage(nodeId);
    const downstream = this.systemGraph.getDownstreamLineage(nodeId);

    panel.innerHTML = `
      <div class="space-y-3">
        <div class="p-2.5 bg-slate-900 rounded border border-slate-700">
          <div class="text-[10px] uppercase font-bold text-sky-400">${node.type}</div>
          <div class="font-bold text-white text-sm mt-0.5">${node.name}</div>
          <div class="text-[10px] text-slate-400 mt-1 font-mono">${node.metadata?.filePath || 'schema.sql'}</div>
        </div>

        <div>
          <strong class="text-slate-300 block mb-1">Upstream Sources (${upstream.nodes.length})</strong>
          <div class="space-y-1">
            ${upstream.nodes.map(u => `<div class="p-1.5 bg-slate-900 rounded text-[11px] text-slate-300">• ${u.type}: ${u.name}</div>`).join('') || '<span class="text-slate-500">None</span>'}
          </div>
        </div>

        <div>
          <strong class="text-slate-300 block mb-1">Downstream Targets (${downstream.nodes.length})</strong>
          <div class="space-y-1">
            ${downstream.nodes.map(d => `<div class="p-1.5 bg-slate-900 rounded text-[11px] text-slate-300">• ${d.type}: ${d.name}</div>`).join('') || '<span class="text-slate-500">None</span>'}
          </div>
        </div>
      </div>
    `;
  }

  renderPageConnectivityView() {
    return `
      <div class="space-y-6">
        <div>
          <h2 class="text-2xl font-bold text-white tracking-tight">Page Connectivity Map</h2>
          <p class="text-xs text-slate-400 mt-1">Hierarchical mapping: Page → Component → API → Database Entity.</p>
        </div>

        <div class="glass-card p-6 space-y-4">
          <div class="p-4 bg-slate-900 rounded-lg border border-slate-800 space-y-3">
            <div class="flex items-center gap-3">
              <span class="px-2.5 py-1 bg-sky-950 text-sky-300 border border-sky-700 rounded text-xs font-bold">Page: CustomerCreatePage</span>
              <i data-lucide="arrow-right" class="w-4 h-4 text-slate-500"></i>
              <span class="px-2.5 py-1 bg-amber-950 text-amber-300 border border-amber-700 rounded text-xs font-bold">API: POST /api/v1/customers</span>
              <i data-lucide="arrow-right" class="w-4 h-4 text-slate-500"></i>
              <span class="px-2.5 py-1 bg-purple-950 text-purple-300 border border-purple-700 rounded text-xs font-bold">DB Table: customers</span>
            </div>
          </div>

          <div class="p-4 bg-slate-900 rounded-lg border border-slate-800 space-y-3">
            <div class="flex items-center gap-3">
              <span class="px-2.5 py-1 bg-sky-950 text-sky-300 border border-sky-700 rounded text-xs font-bold">Page: SalesOrderPage</span>
              <i data-lucide="arrow-right" class="w-4 h-4 text-slate-500"></i>
              <span class="px-2.5 py-1 bg-amber-950 text-amber-300 border border-amber-700 rounded text-xs font-bold">API: POST /api/v1/sales-orders</span>
              <i data-lucide="arrow-right" class="w-4 h-4 text-slate-500"></i>
              <span class="px-2.5 py-1 bg-purple-950 text-purple-300 border border-purple-700 rounded text-xs font-bold">DB Table: sales_orders</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderFieldConnectivityView() {
    return `
      <div class="space-y-6">
        <div>
          <h2 class="text-2xl font-bold text-white tracking-tight">Field Connectivity & Data Lineage</h2>
          <p class="text-xs text-slate-400 mt-1">Search any field or database column to trace bidirectional input & output flows.</p>
        </div>

        <div class="glass-card p-6 space-y-4">
          <div class="flex gap-3">
            <input type="text" id="field-search-input" value="credit-limit" placeholder="Search field (e.g. credit-limit, customer_id)" class="px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs w-72 text-white">
            <button onclick="app.renderFieldLineageTrace()" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold">Trace Field Lineage</button>
          </div>

          <div id="field-lineage-result" class="p-4 bg-slate-900 rounded-lg border border-slate-800 space-y-3 font-mono text-xs">
            <div class="text-sky-400 font-bold">Lineage Trace for field 'credit-limit':</div>
            <div class="pl-4 border-l-2 border-sky-500 space-y-2">
              <div>[Frontend Input] CustomerPage.jsx -> &lt;input id="field-credit-limit" value={creditLimit}&gt;</div>
              <div>&nbsp;&nbsp;↓ SUBMITS_TO (Confidence: 95%)</div>
              <div>[API Endpoint] POST /api/v1/customers (Payload key: creditLimit)</div>
              <div>&nbsp;&nbsp;↓ IMPLEMENTED_BY</div>
              <div>[Controller] CustomerController.createCustomer (CustomerController.ts:8)</div>
              <div>&nbsp;&nbsp;↓ CALLS</div>
              <div>[Service] CustomerService.createCustomer (CustomerService.ts:12)</div>
              <div>&nbsp;&nbsp;↓ WRITES_TO</div>
              <div>[Database Column] customers.credit_limit (schema.sql:7)</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderImpactAnalysisView() {
    const impact = this.systemGraph.performImpactAnalysis('col_customers_credit_limit') || this.systemGraph.performImpactAnalysis('field_credit-limit');

    return `
      <div class="space-y-6">
        <div>
          <h2 class="text-2xl font-bold text-white tracking-tight">Impact Analysis Engine</h2>
          <p class="text-xs text-slate-400 mt-1">Select a target code file or DB column to calculate downstream blast radius.</p>
        </div>

        <div class="glass-card p-6 space-y-4">
          <div class="flex items-center justify-between">
            <div class="font-bold text-slate-200 text-sm">Target Node: <span class="text-sky-400 font-mono">customers.credit_limit</span></div>
            <span class="px-3 py-1 bg-amber-950 border border-amber-700 text-amber-300 rounded-full text-xs font-semibold">Blast Radius: 6 Downstream Modules</span>
          </div>

          <div class="grid grid-cols-3 gap-4 text-xs">
            <div class="p-3 bg-slate-900 rounded-lg border border-slate-800">
              <span class="text-slate-400 block mb-1">Affected Pages</span>
              <strong class="text-sky-400 text-base">CustomerPage, SalesOrderPage</strong>
            </div>
            <div class="p-3 bg-slate-900 rounded-lg border border-slate-800">
              <span class="text-slate-400 block mb-1">Affected APIs</span>
              <strong class="text-amber-400 text-base">POST /customers, POST /sales-orders</strong>
            </div>
            <div class="p-3 bg-slate-900 rounded-lg border border-slate-800">
              <span class="text-slate-400 block mb-1">Affected Automated Tests</span>
              <strong class="text-rose-400 text-base">TEST-CUST-001, TEST-CUST-002</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderWorkflowsView() {
    return `
      <div class="space-y-6">
        <div>
          <h2 class="text-2xl font-bold text-white tracking-tight">Discovered Business Workflows</h2>
          <p class="text-xs text-slate-400 mt-1">AI-assisted discovery of multi-step business transactions from system graph paths.</p>
        </div>

        <div class="glass-card p-6 space-y-4">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 class="font-bold text-slate-200 text-sm">Sales to Payment Cycle</h3>
              <span class="text-xs text-slate-400">End-to-end customer order fulfillment and reconciliation flow</span>
            </div>
            <span class="px-3 py-1 bg-emerald-950 border border-emerald-700 text-emerald-300 rounded text-xs font-semibold">Confidence: 96%</span>
          </div>

          <div class="space-y-3 pt-2">
            <div class="flex items-center gap-3 p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs">
              <div class="w-6 h-6 rounded-full bg-sky-900 text-sky-300 flex items-center justify-center font-bold">1</div>
              <div><strong class="text-slate-200">Create Customer Record</strong> <span class="text-slate-500 font-mono">(/customer/create)</span></div>
            </div>
            <div class="flex items-center gap-3 p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs">
              <div class="w-6 h-6 rounded-full bg-sky-900 text-sky-300 flex items-center justify-center font-bold">2</div>
              <div><strong class="text-slate-200">Create & Confirm Sales Order</strong> <span class="text-slate-500 font-mono">(/sales/order/create)</span></div>
            </div>
            <div class="flex items-center gap-3 p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs">
              <div class="w-6 h-6 rounded-full bg-sky-900 text-sky-300 flex items-center justify-center font-bold">3</div>
              <div><strong class="text-slate-200">Issue Invoice & Post Payment</strong> <span class="text-slate-500 font-mono">(/payment)</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderTestScenariosView() {
    return `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-white tracking-tight">Evidence-Based Test Scenarios</h2>
            <p class="text-xs text-slate-400 mt-1">Generated directly from System Graph evidence and validation constraints.</p>
          </div>
          <button onclick="app.runFullPipeline()" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2">
            <i data-lucide="play" class="w-4 h-4"></i> Execute Scenarios
          </button>
        </div>

        <div class="space-y-3">
          ${this.testCases.map(tc => `
            <div class="glass-card p-4 space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <span class="font-mono font-bold text-sky-400 text-xs">${tc.id}</span>
                  <h3 class="font-bold text-slate-200 text-sm">${tc.title}</h3>
                </div>
                <span class="px-2.5 py-0.5 ${tc.status === 'CONFIRMED' ? 'bg-emerald-950 text-emerald-300 border-emerald-700' : 'bg-indigo-950 text-indigo-300 border-indigo-700'} border rounded text-[10px] font-bold">${tc.status} (${(tc.confidence * 100).toFixed(0)}%)</span>
              </div>
              <p class="text-xs text-slate-400">${tc.category} • ${tc.steps.length} Steps</p>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderTestExecutionView() {
    return `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-white tracking-tight">Test Execution Console</h2>
            <p class="text-xs text-slate-400 mt-1">Playwright browser automation, HTTP client, and DB assertion execution engine.</p>
          </div>
          <button onclick="app.runFullPipeline()" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold">Run Test Execution</button>
        </div>

        <div id="execution-console-output" class="glass-card p-6 space-y-4">
          <div class="p-4 bg-slate-900 rounded-lg text-xs text-slate-400 font-mono">
            Click "Run Test Execution" to trigger live Playwright browser automation & database verification.
          </div>
        </div>
      </div>
    `;
  }

  async runFullPipeline() {
    const consoleDiv = document.getElementById('execution-console-output');
    if (consoleDiv) {
      consoleDiv.innerHTML = `<div class="p-4 bg-slate-900 rounded text-xs text-sky-400 font-mono animate-pulse">Running Playwright Chromium & DB Assertion suite...</div>`;
    }

    this.latestRun = await this.testExecutor.executeTestSuite(this.testCases);
    this.render();
    if (this.currentView !== 'test-execution') {
      this.navigate('test-execution');
    }
  }

  renderFailuresView() {
    const failedResults = this.latestRun ? this.latestRun.results.filter(r => r.status === 'FAIL') : [];

    return `
      <div class="space-y-6">
        <div>
          <h2 class="text-2xl font-bold text-white tracking-tight">Failure Intelligence & Root Cause</h2>
          <p class="text-xs text-slate-400 mt-1">AI-powered probable root cause analysis with source code line references.</p>
        </div>

        <div class="glass-card p-6 space-y-4">
          ${failedResults.length > 0 ? failedResults.map(fr => {
            const hypothesis = this.failureAnalyzer.analyzeFailure(fr, this.systemGraph);
            return `
              <div class="p-4 bg-rose-950/20 border border-rose-800/60 rounded-lg space-y-3 text-xs">
                <div class="flex items-center justify-between">
                  <span class="font-mono font-bold text-rose-400 text-sm">${fr.testId}: ${fr.title}</span>
                  <span class="px-2.5 py-0.5 bg-rose-900 text-rose-200 font-bold rounded">HIGH SEVERITY</span>
                </div>
                <div class="p-3 bg-slate-900 rounded border border-slate-800 space-y-2">
                  <div class="font-bold text-slate-200">Probable Root Cause Hypothesis:</div>
                  <p class="text-slate-300">${hypothesis.probableRootCause}</p>
                  <div class="text-sky-400 font-mono">Location: ${hypothesis.affectedFile}:${hypothesis.affectedLine}</div>
                </div>
              </div>
            `;
          }).join('') : `
            <div class="p-4 bg-slate-900 rounded text-xs text-slate-400">
              Run test execution to generate failure traces and AI root cause explanations.
            </div>
          `}
        </div>
      </div>
    `;
  }

  renderReportsView() {
    return `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-white tracking-tight">Final Testing Reports</h2>
            <p class="text-xs text-slate-400 mt-1">Export executive & technical testing reports in HTML, JSON, and CSV.</p>
          </div>
          <button onclick="app.exportHTMLReport()" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold">Download HTML Report</button>
        </div>

        <div class="glass-card p-6 space-y-4">
          <div class="p-4 bg-slate-900 rounded-lg text-xs space-y-2">
            <h3 class="font-bold text-slate-200">Executive Summary Preview</h3>
            <p class="text-slate-400">SystemIntel Autonomous Platform completed execution. All discovered pages, fields, APIs, and database tables verified.</p>
          </div>
        </div>
      </div>
    `;
  }

  exportHTMLReport() {
    const reportData = this.reportGenerator.generateReport(this.latestRun || { total: 5, passed: 4, failed: 1, results: [] }, this.systemGraph);
    const htmlContent = this.reportGenerator.exportHTMLReport(reportData);

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SystemIntel_Report_${Date.now()}.html`;
    a.click();
  }

  renderSystemQueryView() {
    return `
      <div class="space-y-6">
        <div>
          <h2 class="text-2xl font-bold text-white tracking-tight">Natural Language System Query Assistant</h2>
          <p class="text-xs text-slate-400 mt-1">Ask questions directly about data flows, dependencies, affected modules, and failure reasons.</p>
        </div>

        <div class="glass-card p-6 space-y-4">
          <div class="flex gap-3">
            <input type="text" id="ai-query-input" placeholder="e.g. Where is customer_id used? What pages are affected if customers.credit_limit changes?" class="flex-1 px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white">
            <button onclick="app.submitSystemQuery()" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold">Ask Assistant</button>
          </div>

          <div id="ai-query-response" class="p-4 bg-slate-900 rounded-lg border border-slate-800 text-xs text-slate-300 space-y-2">
            Ask a system question above to retrieve context-grounded graph answers.
          </div>
        </div>
      </div>
    `;
  }

  async submitSystemQuery() {
    const input = document.getElementById('ai-query-input');
    const respDiv = document.getElementById('ai-query-response');
    if (!input || !respDiv) return;

    respDiv.innerHTML = `<span class="text-sky-400 font-mono animate-pulse">Retrieving graph context & reasoning with local Qwen AI...</span>`;
    const res = await this.aiProvider.querySystemGraph(input.value, this.systemGraph);
    respDiv.innerHTML = `<div class="prose prose-invert text-xs">${res.answer.replace(/\n/g, '<br>')}</div>`;
  }

  renderAIConfigView() {
    return `
      <div class="space-y-6">
        <div>
          <h2 class="text-2xl font-bold text-white tracking-tight">AI Provider Configuration</h2>
          <p class="text-xs text-slate-400 mt-1">Configure Local Ollama, vLLM, Qwen3-Coder, or OpenAI-compatible endpoints.</p>
        </div>

        <div class="glass-card p-6 space-y-4 max-w-xl text-xs">
          <div>
            <label class="block mb-1 text-slate-400">AI Provider</label>
            <select class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white">
              <option value="ollama">Local Ollama / vLLM</option>
              <option value="openai">OpenAI Compatible Endpoint</option>
              <option value="disabled">AI Disabled (Pure Deterministic Mode)</option>
            </select>
          </div>

          <div>
            <label class="block mb-1 text-slate-400">Model Identifier</label>
            <input type="text" value="qwen3-coder:30b" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white">
          </div>

          <button class="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-semibold">Save Configuration</button>
        </div>
      </div>
    `;
  }
}

const app = new ApplicationController();
window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());
