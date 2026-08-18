<?php
declare(strict_types=1);

/**
 * Domain exception that carries an HTTP status code.
 * Models throw this — controllers catch it and decide the HTTP response.
 * HTTP concerns never enter the model layer.
 */
class AppException extends RuntimeException
{
    public function __construct(string $message, int $code = 400)
    {
        parent::__construct($message, $code);
    }
}
