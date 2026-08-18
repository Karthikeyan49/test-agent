<?php
declare(strict_types=1);

class Router
{
    private array $routes = [];

    public function get(string $path, array $handler, bool|string $auth = false): void    { $this->add('GET',    $path, $handler, $auth); }
    public function post(string $path, array $handler, bool|string $auth = false): void   { $this->add('POST',   $path, $handler, $auth); }
    public function put(string $path, array $handler, bool|string $auth = false): void    { $this->add('PUT',    $path, $handler, $auth); }
    public function patch(string $path, array $handler, bool|string $auth = false): void  { $this->add('PATCH',  $path, $handler, $auth); }
    public function delete(string $path, array $handler, bool|string $auth = false): void { $this->add('DELETE', $path, $handler, $auth); }

    private function add(string $method, string $path, array $handler, bool|string $auth): void
    {
        $this->routes[] = compact('method', 'path', 'handler', 'auth');
    }

    public function dispatch(): void
    {
        $request     = new Request();
        $httpMethod  = $request->method();
        $uri         = $request->path();
        $pathMatched = false;

        foreach ($this->routes as $route) {
            $params = $this->matchPath($route['path'], $uri);
            if ($params === null) {
                continue;
            }

            $pathMatched = true;

            if ($route['method'] !== $httpMethod) {
                continue;
            }

            $request->params = $params;

            if (is_string($route['auth']) && str_starts_with($route['auth'], 'admin')) {
                AuthMiddleware::handle($request);
                AdminMiddleware::handle($request, $route['auth']);
            } elseif ($route['auth'] === 'dealer') {
                AuthMiddleware::handle($request);
                if (($request->user['user_type'] ?? '') !== 'dealer') {
                    Response::error('Dealer access required', 403);
                }
            } elseif ($route['auth'] === true || $route['auth'] === 'auth') {
                AuthMiddleware::handle($request);
            }

            [$class, $action] = $route['handler'];
            (new $class())->$action($request);
            return;
        }

        if ($pathMatched) {
            $allowed = [];
            foreach ($this->routes as $r) {
                if ($this->matchPath($r['path'], $uri) !== null) {
                    $allowed[] = $r['method'];
                }
            }
            header('Allow: ' . implode(', ', array_unique($allowed)));
            Response::error('Method not allowed', 405);
        }

        Response::error('Route not found', 404);
    }

    private function matchPath(string $pattern, string $uri): ?array
    {
        $regex = preg_replace('/\{(\w+)\}/', '(?P<$1>[^/]+)', $pattern);
        $regex = '#^' . $regex . '$#';

        if (!preg_match($regex, $uri, $matches)) {
            return null;
        }

        return array_filter($matches, fn($k) => is_string($k), ARRAY_FILTER_USE_KEY);
    }
}
