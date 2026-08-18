<?php
declare(strict_types=1);

class AdminInsightsController
{
    /**
     * Generate AI insights for a specific category
     * POST /api/admin/insights/generate
     */
    public function generate(Request $request): void
    {
        try {
            $category = $request->input('category');
            
            if (!in_array($category, ['sales', 'expenses', 'employees', 'production'])) {
                Response::error('Invalid category. Must be: sales, expenses, employees, or production', 400);
                return;
            }
            
            // 1. Fetch aggregated data
            $data = Insights::getData($category);
            
            // 2. Build AI prompt
            $prompt = $this->buildPrompt($category, $data);
            
            // 3. Call Groq API
            $response = GroqAPI::chat([
                ['role' => 'system', 'content' => $this->getSystemPrompt()],
                ['role' => 'user', 'content' => $prompt]
            ], 'llama-3.3-70b-versatile', 0.7);
            
            // 4. Extract and parse JSON
            $insights = GroqAPI::extractJSON($response);
            
            // 5. Add metadata
            $insights['generatedAt'] = date('Y-m-d H:i:s');
            $insights['category'] = $category;
            
            Response::success($insights);
            
        } catch (Exception $e) {
            error_log('Insights generation error: ' . $e->getMessage());
            Response::error('Failed to generate insights: ' . $e->getMessage(), 500);
        }
    }
    
    /**
     * Get system prompt for AI
     */
    private function getSystemPrompt(): string
    {
        return "You are a business analyst for Eco Sudar, a biomass pellet manufacturing company in India. 
You analyze business data and provide actionable insights with specific mitigation steps and performance projections.

Always respond with valid JSON in the exact structure requested.
Be specific with numbers, percentages, and timelines.
Provide clear cause-and-effect relationships.
Focus on actionable recommendations that can be implemented immediately.";
    }
    
    /**
     * Build category-specific prompt
     */
    private function buildPrompt(string $category, array $data): string
    {
        $dataJson = json_encode($data, JSON_PRETTY_PRINT);
        
        $categoryContext = $this->getCategoryContext($category);
        
        return <<<PROMPT
Analyze the following {$category} data for Eco Sudar and provide insights:

BUSINESS CONTEXT:
{$categoryContext}

DATA:
{$dataJson}

Provide insights in this EXACT JSON structure:

{
  "recommendations": [
    {
      "title": "Brief actionable recommendation",
      "detail": "Detailed explanation with specific numbers from the data",
      "mitigation": {
        "steps": ["Specific step 1", "Specific step 2", "Specific step 3"],
        "expected_outcome": "Measurable outcome with numbers",
        "timeline": "Realistic timeline (e.g., '2-3 weeks', '1 month')",
        "cost_effort": "Low|Medium|High"
      }
    }
  ],
  "criticalIssues": [
    {
      "title": "Critical issue requiring immediate attention",
      "detail": "Detailed explanation with impact analysis",
      "mitigation": {
        "steps": ["Immediate action 1", "Action 2", "Action 3"],
        "expected_outcome": "How this prevents/solves the problem",
        "timeline": "Immediate|This Week|This Month",
        "severity": "High|Critical",
        "impact_if_ignored": "Specific consequences if not addressed"
      }
    }
  ],
  "improvements": [
    {
      "title": "Area for improvement",
      "detail": "Current situation with numbers",
      "improvement": {
        "suggestions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"],
        "performance_impact": {
          "if_we_do": "Specific action to take",
          "then_improves": "What metric improves",
          "by_percentage": "X% improvement or specific number"
        },
        "timeline": "Implementation timeline",
        "before_after": {
          "before": "Current metric value",
          "after": "Expected metric value"
        }
      }
    }
  ],
  "performanceMetrics": [
    {
      "title": "Key performance metric",
      "detail": "Current value and context",
      "metric": {
        "current_value": "Actual number with unit",
        "target_value": "Goal or benchmark",
        "trend": "improving|declining|stable",
        "how_to_improve": ["Action 1", "Action 2", "Action 3"],
        "projected_impact": {
          "if_we_do": "Specific action",
          "metric_becomes": "New projected value",
          "additional_benefits": "Other positive impacts"
        },
        "projected_timeline": "Time to reach target"
      }
    }
  ]
}

IMPORTANT RULES:
1. Use ONLY the data provided - do not make up numbers
2. If data is insufficient, provide fewer insights rather than inventing data
3. Be specific with Indian Rupees (₹) for monetary values
4. Use realistic timelines based on business context
5. Provide 2-4 items per category (not more)
6. Focus on HIGH-IMPACT, ACTIONABLE insights
7. Return ONLY valid JSON, no markdown formatting

Respond with the JSON now:
PROMPT;
    }
    
    /**
     * Get business context for each category
     */
    private function getCategoryContext(string $category): string
    {
        $contexts = [
            'sales' => 'Eco Sudar manufactures biomass pellets and briquettes. Key customers include industrial buyers and distributors. Focus on revenue growth, payment collection, and customer retention.',
            
            'expenses' => 'Major expense categories include raw materials (wood powder, sawdust), machinery maintenance, labor, and utilities. Focus on cost optimization and vendor management.',
            
            'employees' => 'Workforce includes production line operators, quality control staff, maintenance technicians, and administrative staff. Focus on attendance, productivity, and labor law compliance.',
            
            'production' => 'Production involves SOPs for manufacturing processes, workflows for approvals, tasks for daily operations, and meetings for coordination. Focus on efficiency, bottlenecks, and process improvements.'
        ];
        
        return $contexts[$category] ?? '';
    }
}