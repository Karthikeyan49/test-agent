<?php
declare(strict_types=1);

class GroqAPI
{
    private static string $baseUrl = 'https://api.groq.com/openai/v1/chat/completions';
    
    /**
     * Send a chat completion request to Groq API
     * 
     * @param array $messages Array of message objects with 'role' and 'content'
     * @param string $model Model to use (default: llama-3.1-70b-versatile)
     * @param float $temperature Temperature for response randomness (0-2)
     * @return array Parsed response from Groq API
     * @throws Exception If API call fails
     */
    public static function chat(
        array $messages,
        string $model = 'llama-3.3-70b-versatile',
        float $temperature = 0.7
    ): array {
        // Use GROQ_API_KEY_NEW constant (loaded from .env via database.php)
        $apiKey = defined('GROQ_API_KEY_NEW') ? GROQ_API_KEY_NEW : '';
        
        if (empty($apiKey)) {
            throw new Exception('GROQ_API_KEY_NEW not configured. Please add groq_api_key_new to .env file');
        }
        
        $payload = [
            'model' => $model,
            'messages' => $messages,
            'temperature' => $temperature,
            'max_tokens' => 4096,
        ];
        
        $ch = curl_init(self::$baseUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ]);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        
        if ($error) {
            throw new Exception('Groq API request failed: ' . $error);
        }
        
        if ($httpCode !== 200) {
            $errorData = json_decode($response, true);
            $errorMessage = $errorData['error']['message'] ?? 'Unknown error';
            throw new Exception('Groq API error (HTTP ' . $httpCode . '): ' . $errorMessage);
        }
        
        $data = json_decode($response, true);
        
        if (!isset($data['choices'][0]['message']['content'])) {
            throw new Exception('Invalid response from Groq API');
        }
        
        return $data;
    }
    
    /**
     * Extract the content from a Groq API response
     * 
     * @param array $response Response from chat() method
     * @return string The message content
     */
    public static function extractContent(array $response): string
    {
        return $response['choices'][0]['message']['content'] ?? '';
    }
    
    /**
     * Parse JSON response from Groq API
     * 
     * @param array $response Response from chat() method
     * @return array Parsed JSON data
     * @throws Exception If JSON parsing fails
     */
    public static function extractJSON(array $response): array
    {
        $content = self::extractContent($response);
        
        // Try to extract JSON from markdown code blocks if present
        if (preg_match('/```json\s*(.*?)\s*```/s', $content, $matches)) {
            $content = $matches[1];
        } elseif (preg_match('/```\s*(.*?)\s*```/s', $content, $matches)) {
            $content = $matches[1];
        }
        
        $data = json_decode($content, true);
        
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new Exception('Failed to parse JSON from Groq response: ' . json_last_error_msg());
        }
        
        return $data;
    }
}