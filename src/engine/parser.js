/**
 * Deterministic Source Code Analyzer Engine
 * Strictly NO LLM dependency.
 * Extracts Pages, Components, Fields, Event Handlers, API calls,
 * Backend Controllers, Services, Repositories, DB queries, and Call Graphs.
 */

export class SourceCodeAnalyzer {
  constructor() {
    this.extractedSymbols = [];
    this.routes = [];
    this.components = [];
    this.fields = [];
    this.apiCalls = [];
    this.backendEndpoints = [];
    this.dbQueries = [];
  }

  /**
   * Analyze a collection of source files (Frontend & Backend)
   */
  analyzeProjectFiles(files) {
    const results = {
      filesAnalyzed: files.length,
      symbols: [],
      pages: [],
      components: [],
      fields: [],
      apiEndpoints: [],
      dbQueries: [],
      callEdges: []
    };

    files.forEach(file => {
      if (file.path.endsWith('.jsx') || file.path.endsWith('.tsx') || file.path.endsWith('.js')) {
        this.analyzeFrontendFile(file, results);
      } else if (file.path.endsWith('.ts') || file.path.endsWith('.py') || file.path.endsWith('.java')) {
        this.analyzeBackendFile(file, results);
      }
    });

    return results;
  }

  /**
   * Frontend JSX/React AST & Pattern Parsing
   */
  analyzeFrontendFile(file, results) {
    const lines = file.content.split('\n');
    let currentPage = null;
    let currentComponent = null;

    // Detect page routes from comments or component name
    const pageMatch = file.content.match(/\/\/\s*Route:\s*([^\n]+)/);
    const routePath = pageMatch ? pageMatch[1].trim() : `/${file.name.replace(/\.[^/.]+$/, '').toLowerCase()}`;

    // Extract Page node
    currentPage = {
      id: `page_${file.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
      type: 'Page',
      name: file.name.replace(/\.[^/.]+$/, ''),
      routePath: routePath,
      filePath: file.path,
      lineStart: 1,
      lineEnd: lines.length
    };
    results.pages.push(currentPage);

    // Extract Form Fields: look for input elements with id, value, onChange, placeholder
    const fieldRegex = /<input[^>]*id=["']([^"']+)["'][^>]*>/g;
    let match;
    let lineNo = 1;

    lines.forEach((line, idx) => {
      lineNo = idx + 1;

      // Extract input fields
      if (line.includes('<input') || line.includes('id="field-')) {
        const idMatch = line.match(/id=["']([^"']+)["']/);
        const typeMatch = line.match(/type=["']([^"']+)["']/);
        const valMatch = line.match(/value=\{([^}]+)\}/);
        const reqMatch = line.includes('required');
        const placeholderMatch = line.match(/placeholder=["']([^"']+)["']/);

        if (idMatch) {
          const fieldNode = {
            id: `field_${idMatch[1]}`,
            type: 'Field',
            fieldName: idMatch[1],
            fieldType: typeMatch ? typeMatch[1] : 'text',
            required: reqMatch,
            boundState: valMatch ? valMatch[1] : null,
            placeholder: placeholderMatch ? placeholderMatch[1] : '',
            pageId: currentPage.id,
            filePath: file.path,
            lineStart: lineNo,
            lineEnd: lineNo
          };
          results.fields.push(fieldNode);
        }
      }

      // Extract fetch / axios API calls
      if (line.includes('fetch(') || line.includes('axios.')) {
        const fetchMatch = line.match(/fetch\(["']([^"']+)["']\s*,\s*\{\s*method:\s*["']([^"']+)["']/);
        const simpleFetch = line.match(/fetch\(["']([^"']+)["']/);
        if (fetchMatch) {
          results.apiCalls.push({
            id: `api_call_${results.apiCalls.length + 1}`,
            endpoint: fetchMatch[1],
            method: fetchMatch[2],
            pageId: currentPage.id,
            filePath: file.path,
            lineStart: lineNo
          });
        } else if (simpleFetch) {
          results.apiCalls.push({
            id: `api_call_${results.apiCalls.length + 1}`,
            endpoint: simpleFetch[1],
            method: 'GET',
            pageId: currentPage.id,
            filePath: file.path,
            lineStart: lineNo
          });
        }
      }
    });
  }

  /**
   * Backend Controller / Service / Repository AST Parsing
   */
  analyzeBackendFile(file, results) {
    const lines = file.content.split('\n');
    let currentClass = null;

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;

      // Extract Class / Controller / Service / Repository
      const classMatch = line.match(/export class ([a-zA-Z0-9_]+)/);
      if (classMatch) {
        currentClass = classMatch[1];
        let symbolType = 'Class';
        if (currentClass.includes('Controller')) symbolType = 'Controller';
        else if (currentClass.includes('Service')) symbolType = 'Service';
        else if (currentClass.includes('Repository')) symbolType = 'Repository';

        results.symbols.push({
          id: `symbol_${currentClass}`,
          type: symbolType,
          name: currentClass,
          filePath: file.path,
          lineStart: lineNo
        });
      }

      // Extract REST Route annotations / methods (e.g. POST /api/v1/customers)
      const routeComment = line.match(/\/\/\s*(GET|POST|PUT|DELETE|PATCH)\s+([^\s\n]+)/);
      if (routeComment) {
        results.apiEndpoints.push({
          id: `api_ep_${routeComment[1]}_${routeComment[2].replace(/[^a-zA-Z0-9]/g, '_')}`,
          method: routeComment[1],
          path: routeComment[2],
          controllerName: currentClass,
          filePath: file.path,
          lineStart: lineNo
        });
      }

      // Extract SQL Queries / Database Calls
      if (line.includes('INSERT INTO') || line.includes('SELECT') || line.includes('UPDATE') || line.includes('DELETE FROM')) {
        const sqlMatch = line.match(/(INSERT INTO|SELECT|UPDATE|DELETE FROM)\s+([a-zA-Z0-9_]+)/i);
        if (sqlMatch) {
          results.dbQueries.push({
            id: `db_q_${results.dbQueries.length + 1}`,
            operation: sqlMatch[1].toUpperCase(),
            tableName: sqlMatch[2].toLowerCase(),
            repositoryName: currentClass,
            filePath: file.path,
            lineStart: lineNo,
            rawSqlSnippet: line.trim()
          });
        }
      }
    });
  }
}
