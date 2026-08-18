<?php
declare(strict_types=1);

class GroqClient
{
    private const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
    private const MODEL   = 'llama-3.3-70b-versatile';
    private const TIMEOUT = 30;

    /**
     * Send messages to Groq and return the assistant reply text.
     *
     * @param array $messages  [['role'=>'system'|'user'|'assistant', 'content'=>'...']]
     * @param int   $maxTokens
     * @return string
     * @throws RuntimeException on curl/API failure
     */
    public static function chat(array $messages, int $maxTokens = 512): string
    {
        $apiKey = GROQ_API_KEY;
        if (empty($apiKey)) {
            throw new \RuntimeException('GROQ_API_KEY is not configured.');
        }

        $payload = json_encode([
            'model'       => self::MODEL,
            'messages'    => $messages,
            'max_tokens'  => $maxTokens,
            'temperature' => 0.3,
        ]);

        $ch = curl_init(self::API_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_TIMEOUT        => self::TIMEOUT,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey,
            ],
        ]);

        $body  = curl_exec($ch);
        $errno = curl_errno($ch);
        curl_close($ch);

        if ($errno || $body === false) {
            throw new \RuntimeException('Groq API request failed: ' . curl_strerror($errno));
        }

        $data = json_decode($body, true);

        if (!isset($data['choices'][0]['message']['content'])) {
            $err = $data['error']['message'] ?? 'Unknown Groq error';
            throw new \RuntimeException('Groq error: ' . $err);
        }

        return trim($data['choices'][0]['message']['content']);
    }
}
