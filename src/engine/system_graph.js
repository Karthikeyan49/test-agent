/**
 * System Graph & Data Lineage Engine
 * Constructs machine-readable hierarchical graph & reverse lineage.
 * Manages Nodes, Edges, Evidence, Confidence, Data Lineage & Impact Analysis.
 */

export class SystemGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.transformations = [];
  }

  addNode(node) {
    if (!node.id) throw new Error("Node must have an ID");
    this.nodes.set(node.id, {
      ...node,
      createdAt: new Date().toISOString()
    });
    return node.id;
  }

  addEdge(edge) {
    const fullEdge = {
      id: `edge_${this.edges.length + 1}`,
      source: edge.source,
      target: edge.target,
      relationship: edge.relationship,
      confidence: edge.confidence ?? 1.0,
      discoveryMethod: edge.discoveryMethod || 'STATIC_ANALYSIS',
      sourceFile: edge.sourceFile || '',
      sourceLine: edge.sourceLine || 1,
      reason: edge.reason || '',
      createdAt: new Date().toISOString()
    };
    this.edges.push(fullEdge);
    return fullEdge;
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  getAllNodes() {
    return Array.from(this.nodes.values());
  }

  getAllEdges() {
    return this.edges;
  }

  /**
   * Build graph from analyzed frontend, backend, and DB schema results
   */
  buildFromAnalysis(feResults, beResults, dbResults) {
    // 1. Add DB Tables & Columns
    dbResults.tables.forEach(table => {
      this.addNode({
        id: table.id,
        type: 'Table',
        name: table.name,
        category: 'Database',
        metadata: { rowCount: table.rowCount }
      });

      table.columns.forEach(col => {
        this.addNode({
          id: col.id,
          type: 'Column',
          name: col.name,
          category: 'Database',
          metadata: { dataType: col.dataType, isPk: col.isPrimaryKey, tableName: table.name }
        });

        // Table CONTAINS Column
        this.addEdge({
          source: table.id,
          target: col.id,
          relationship: 'CONTAINS',
          confidence: 1.0,
          discoveryMethod: 'DATABASE_ANALYSIS'
        });
      });
    });

    // Add Foreign Keys (Table REFERENCES Table / Column REFERENCES Column)
    dbResults.foreignKeys.forEach(fk => {
      const srcColId = `col_${fk.sourceTable}_${fk.sourceColumn}`;
      const tgtColId = `col_${fk.targetTable}_${fk.targetColumn}`;
      if (this.nodes.has(srcColId) && this.nodes.has(tgtColId)) {
        this.addEdge({
          source: srcColId,
          target: tgtColId,
          relationship: 'REFERENCES',
          confidence: 1.0,
          discoveryMethod: 'DATABASE_ANALYSIS',
          reason: `Foreign key constraint from ${fk.sourceTable}.${fk.sourceColumn} to ${fk.targetTable}.${fk.targetColumn}`
        });
      }
    });

    // 2. Add Frontend Pages & Fields
    feResults.pages.forEach(page => {
      this.addNode({
        id: page.id,
        type: 'Page',
        name: page.name,
        category: 'Frontend',
        metadata: { routePath: page.routePath, filePath: page.filePath }
      });
    });

    feResults.fields.forEach(field => {
      this.addNode({
        id: field.id,
        type: 'Field',
        name: field.fieldName,
        category: 'Frontend',
        metadata: {
          fieldType: field.fieldType,
          required: field.required,
          boundState: field.boundState,
          filePath: field.filePath
        }
      });

      // Page CONTAINS_FIELD Field
      this.addEdge({
        source: field.pageId,
        target: field.id,
        relationship: 'CONTAINS_FIELD',
        confidence: 1.0,
        discoveryMethod: 'STATIC_ANALYSIS',
        sourceFile: field.filePath,
        sourceLine: field.lineStart
      });
    });

    // 3. Add Backend Controllers, Services, Repositories, API Endpoints
    feResults.apiEndpoints.forEach(ep => {
      this.addNode({
        id: ep.id,
        type: 'APIEndpoint',
        name: `${ep.method} ${ep.path}`,
        category: 'API',
        metadata: { method: ep.method, path: ep.path, filePath: ep.filePath }
      });
    });

    feResults.symbols.forEach(sym => {
      this.addNode({
        id: sym.id,
        type: sym.type, // Controller, Service, Repository
        name: sym.name,
        category: 'Backend',
        metadata: { filePath: sym.filePath }
      });
    });

    // 4. Construct End-to-End Lineage Edges
    // Frontend Field -> API Endpoint
    feResults.fields.forEach(field => {
      // Deterministically match field name / page to API call endpoint
      feResults.apiCalls.forEach(call => {
        if (call.pageId === field.pageId) {
          const apiEpId = feResults.apiEndpoints.find(ep => ep.path === call.endpoint)?.id;
          if (apiEpId) {
            this.addEdge({
              source: field.id,
              target: apiEpId,
              relationship: 'SUBMITS_TO',
              confidence: 0.95,
              discoveryMethod: 'STATIC_ANALYSIS',
              reason: `Field '${field.fieldName}' is submitted via fetch call to ${call.endpoint}`
            });
          }
        }
      });
    });

    // API Endpoint -> Controller -> Service -> Repository -> Database Table
    feResults.apiEndpoints.forEach(ep => {
      const controllerNodeId = `symbol_${ep.controllerName}`;
      if (this.nodes.has(controllerNodeId)) {
        this.addEdge({
          source: ep.id,
          target: controllerNodeId,
          relationship: 'IMPLEMENTED_BY',
          confidence: 1.0,
          discoveryMethod: 'STATIC_ANALYSIS'
        });
      }
    });

    feResults.symbols.forEach(sym => {
      if (sym.type === 'Controller') {
        const serviceName = sym.name.replace('Controller', 'Service');
        const serviceNodeId = `symbol_${serviceName}`;
        if (this.nodes.has(serviceNodeId)) {
          this.addEdge({
            source: sym.id,
            target: serviceNodeId,
            relationship: 'CALLS',
            confidence: 1.0,
            discoveryMethod: 'STATIC_ANALYSIS'
          });
        }
      } else if (sym.type === 'Service') {
        const repoName = sym.name.replace('Service', 'Repository');
        const repoNodeId = `symbol_${repoName}`;
        if (this.nodes.has(repoNodeId)) {
          this.addEdge({
            source: sym.id,
            target: repoNodeId,
            relationship: 'CALLS',
            confidence: 1.0,
            discoveryMethod: 'STATIC_ANALYSIS'
          });
        }
      }
    });

    // Repository -> DB Table & Column
    feResults.dbQueries.forEach(q => {
      const repoNodeId = `symbol_${q.repositoryName}`;
      const tableNodeId = `table_${q.tableName}`;

      if (this.nodes.has(repoNodeId) && this.nodes.has(tableNodeId)) {
        const relType = q.operation === 'SELECT' ? 'READS_FROM' : 'WRITES_TO';
        this.addEdge({
          source: repoNodeId,
          target: tableNodeId,
          relationship: relType,
          confidence: 1.0,
          discoveryMethod: 'STATIC_ANALYSIS',
          sourceFile: q.filePath,
          sourceLine: q.lineStart,
          reason: `SQL ${q.operation} executed against table '${q.tableName}'`
        });
      }
    });

    // 5. Explicit Transformation Lineage
    this.addTransformation({
      output: 'field_grand_total',
      inputs: ['field_quantity', 'field_unit_price', 'field_tax', 'field_discount'],
      expression: 'quantity * unit_price + tax - discount',
      confidence: 0.98,
      sourceFile: 'SalesOrderPage.jsx'
    });
  }

  addTransformation(trans) {
    this.transformations.push({
      ...trans,
      id: `trans_${this.transformations.length + 1}`
    });
  }

  /**
   * Upstream Lineage (What feeds into this node?)
   */
  getUpstreamLineage(nodeId, maxDepth = 5) {
    const visited = new Set();
    const resultNodes = [];
    const resultEdges = [];

    const traverse = (currentId, depth) => {
      if (depth > maxDepth || visited.has(currentId)) return;
      visited.add(currentId);

      const incomingEdges = this.edges.filter(e => e.target === currentId);
      incomingEdges.forEach(edge => {
        resultEdges.push(edge);
        if (this.nodes.has(edge.source)) {
          resultNodes.push(this.nodes.get(edge.source));
          traverse(edge.source, depth + 1);
        }
      });
    };

    traverse(nodeId, 0);
    return { nodes: resultNodes, edges: resultEdges };
  }

  /**
   * Downstream Lineage (What does this node affect?)
   */
  getDownstreamLineage(nodeId, maxDepth = 5) {
    const visited = new Set();
    const resultNodes = [];
    const resultEdges = [];

    const traverse = (currentId, depth) => {
      if (depth > maxDepth || visited.has(currentId)) return;
      visited.add(currentId);

      const outgoingEdges = this.edges.filter(e => e.source === currentId);
      outgoingEdges.forEach(edge => {
        resultEdges.push(edge);
        if (this.nodes.has(edge.target)) {
          resultNodes.push(this.nodes.get(edge.target));
          traverse(edge.target, depth + 1);
        }
      });
    };

    traverse(nodeId, 0);
    return { nodes: resultNodes, edges: resultEdges };
  }

  /**
   * Perform Impact Analysis when a node (e.g. customers.credit_limit) changes
   */
  performImpactAnalysis(targetNodeId) {
    const targetNode = this.getNode(targetNodeId);
    if (!targetNode) return null;

    const downstream = this.getDownstreamLineage(targetNodeId);
    const affectedPages = downstream.nodes.filter(n => n.type === 'Page');
    const affectedAPIs = downstream.nodes.filter(n => n.type === 'APIEndpoint');
    const affectedTables = downstream.nodes.filter(n => n.type === 'Table');

    return {
      targetNode,
      directDependenciesCount: downstream.edges.filter(e => e.source === targetNodeId).length,
      totalAffectedNodesCount: downstream.nodes.length,
      affectedPages,
      affectedAPIs,
      affectedTables,
      downstreamNodes: downstream.nodes,
      downstreamEdges: downstream.edges
    };
  }
}
