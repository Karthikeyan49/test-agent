<?php
declare(strict_types=1);

class Response
{
    public static function success(mixed $data = null, string $message = 'Success', int $code = 200): never
    {
        self::send(['success' => true, 'message' => $message, 'data' => $data], $code);
    }

    public static function error(string $message, int $code = 400, mixed $errors = null): never
    {
        $body = ['success' => false, 'message' => $message];
        if ($errors !== null) {
            $body['errors'] = $errors;
        }
        self::send($body, $code);
    }

    public static function validationError(array $errors): never
    {
        self::error('Validation failed', 422, $errors);
    }

    public static function paginated(array $data, array $pagination, int $code = 200): never
    {
        self::send([
            'success'    => true,
            'data'       => $data,
            'pagination' => $pagination,
        ], $code);
    }

    private static function send(array $body, int $code): never
    {
        http_response_code($code);
        echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
}
