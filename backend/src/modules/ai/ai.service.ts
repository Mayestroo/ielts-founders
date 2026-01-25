import { Injectable, Logger } from '@nestjs/common';

export interface WritingEvaluation {
  bandScore: number;
  taskAchievement: { score: number; feedback: string };
  coherenceAndCohesion: { score: number; feedback: string };
  lexicalResource: { score: number; feedback: string };
  grammaticalRangeAndAccuracy: { score: number; feedback: string };
  overallFeedback: string;
  strengths: string[];
  areasForImprovement: string[];
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly keys: string[];
  private currentKeyIndex = 0;

  constructor() {
    const keysString = process.env.GEMINI_API_KEY || '';
    this.keys = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    
    if (this.keys.length === 0) {
      this.logger.warn('GEMINI_API_KEY not configured. AI evaluation will not work.');
    } else {
      this.logger.log(`Loaded ${this.keys.length} Gemini API key(s)`);
    }
  }

  private getNextKey(): string {
    if (this.keys.length === 0) return '';
    const key = this.keys[this.currentKeyIndex];
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.keys.length;
    return key;
  }

  async evaluateWritingSection(
    tasks: { id: string; description: string; response: string }[]
  ): Promise<{ bandScore: number; tasks: Record<string, WritingEvaluation> }> {
    if (this.keys.length === 0) {
      this.logger.warn('Skipping AI evaluation: No API key');
      return { 
        bandScore: 0, 
        tasks: {} 
      };
    }

    const taskEvaluations: Record<string, WritingEvaluation> = {};
    let weightedScoreSum = 0;
    let totalWeight = 0;

    for (const task of tasks) {
      if (!task.response || task.response.trim().length < 20) {
        this.logger.warn(`Skipping task ${task.id}: Response too short`);
        continue;
      }

      try {
        const evaluation = await this.evaluateWritingTask(task.description, task.response);
        taskEvaluations[task.id] = evaluation;

        // Apply standard IELTS weighting
        // Task 1 carries 1/3 weight, Task 2 carries 2/3 weight
        const weight = task.id.toLowerCase().includes('task 2') ? 2 : 1;
        weightedScoreSum += evaluation.bandScore * weight;
        totalWeight += weight;
      } catch (error) {
        this.logger.error(`Failed to evaluate task ${task.id}:`, error);
        // Continue to next task even if one fails
      }
    }

    // Calculate final band score rounded to nearest 0.5
    let finalBandScore = 0;
    if (totalWeight > 0) {
      const average = weightedScoreSum / totalWeight;
      // Round to nearest 0.5: (round(x * 2) / 2)
      finalBandScore = Math.round(average * 2) / 2;
    }

    return {
      bandScore: finalBandScore,
      tasks: taskEvaluations,
    };
  }

  // Multi-model fallback strategy
  private readonly models = [
    'gemini-2.5-flash',        // Try this first (has quota available)
    'gemini-2.0-flash-lite',   // Lighter version
    'gemini-2.0-flash',        // Original (may be rate limited)
    'gemini-2.5-pro',          // More powerful fallback
  ];

  // Helper for delay
  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Changed to generic evaluation method
  async evaluateWritingTask(taskDescription: string, studentResponse: string): Promise<WritingEvaluation> {
    if (this.keys.length === 0) {
      throw new Error('Gemini API key not configured');
    }

    if (!studentResponse || studentResponse.trim().length < 20) {
       // Return minimal evaluation for very short answers to avoid API errors
       return {
         bandScore: 1,
         overallFeedback: 'Response is too short to evaluate meaningfuly.',
         strengths: [],
         areasForImprovement: ['Write more to demonstrate your ability.'],
         taskAchievement: { score: 1, feedback: 'Insufficient length.' },
         coherenceAndCohesion: { score: 1, feedback: 'Insufficient length.' },
         lexicalResource: { score: 1, feedback: 'Insufficient length.' },
         grammaticalRangeAndAccuracy: { score: 1, feedback: 'Insufficient length.' }
       };
    }

    const prompt = this.buildEvaluationPrompt(taskDescription, studentResponse);
    let lastError: any = null;

    // Retry logic with key rotation
    // We try models, and for each model we try available keys if we hit rate limits
    for (const model of this.models) {
      // Try up to the number of keys times for each model (if rate limited)
      // or just once if other error
      let attempts = 0;
      const maxAttempts = this.keys.length; // Try each key once per model if needed

      while (attempts < maxAttempts) {
        attempts++;
        const currentApiKey = this.getNextKey();
        
        try {
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
          this.logger.log(`Attempting evaluation with model: ${model} (Key ending in ...${currentApiKey.slice(-4)})`);

          const response = await fetch(`${apiUrl}?key=${currentApiKey}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [{ text: prompt }],
                },
              ],
              generationConfig: {
                temperature: 0.3,
                topP: 0.8,
                maxOutputTokens: 2048,
              },
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            const statusCode = response.status;
            
            if (statusCode === 429) {
              this.logger.warn(`Model ${model} rate limited (429) with key ...${currentApiKey.slice(-4)}. Rotating key...`);
              await this.delay(500); // Short delay before retrying with next key
              continue; // Try next key
            }

            this.logger.error(`Gemini API error (${model}): ${statusCode} - ${errorText}`);
            throw new Error(`Gemini API error: ${statusCode}`);
          }

          const data = await response.json();
          const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

          if (!textContent) {
            throw new Error(`No response from Gemini API using model ${model}`);
          }

          return this.parseEvaluationResponse(textContent);
        } catch (error) {
          lastError = error;
          // If it really wasn't a 429 (caught above), we might want to break inner loop and try next model
          // But if we caught an error inside try block (like fetch failure), we check message
          if (error.message && error.message.includes('429')) {
             // It was a rate limit, loop continues to next key
             continue;
          }
          
          this.logger.error(`Error with model ${model}:`, error.message);
          // For non-rate-limit errors, maybe try next model immediately
          break; 
        }
      }
      
      // If we are here, it means we exhausted keys for this model OR hit a non-429 error
      // proceed to next model
    }

    this.logger.error('All Gemini models and keys failed.');
    throw lastError || new Error('All AI evaluation attempts failed');
  }

  private buildEvaluationPrompt(taskDescription: string, studentResponse: string): string {
    const wordCount = studentResponse.trim().split(/\s+/).filter(w => w).length;

    return `You are an expert IELTS examiner. Evaluate the following IELTS Writing Task response according to the official IELTS band descriptors.

## Task Description:
${taskDescription || 'IELTS Writing Task'}

## Student Response (${wordCount} words):
${studentResponse}

## Instructions:
Evaluate this response based on the four IELTS Writing assessment criteria:
1. Task Achievement (Task 1) / Task Response (Task 2)
2. Coherence and Cohesion
3. Lexical Resource
4. Grammatical Range and Accuracy

Provide your evaluation in the following JSON format ONLY (no markdown, no explanations outside JSON):

{
  "bandScore": <overall band score as a number between 1 and 9, can use .5 increments>,
  "taskAchievement": {
    "score": <band score for this criterion>,
    "feedback": "<brief feedback for this criterion>"
  },
  "coherenceAndCohesion": {
    "score": <band score for this criterion>,
    "feedback": "<brief feedback for this criterion>"
  },
  "lexicalResource": {
    "score": <band score for this criterion>,
    "feedback": "<brief feedback for this criterion>"
  },
  "grammaticalRangeAndAccuracy": {
    "score": <band score for this criterion>,
    "feedback": "<brief feedback for this criterion>"
  },
  "overallFeedback": "<2-3 sentence summary of the response quality>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "areasForImprovement": ["<area 1>", "<area 2>"]
}`;
  }

  private parseEvaluationResponse(text: string): WritingEvaluation {
    // Try to extract JSON from the response
    let jsonString = text.trim();
    
    // Remove markdown code blocks if present
    const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1].trim();
    }

    // Try to find JSON object in the text
    const objectMatch = jsonString.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonString = objectMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonString);
      
      return {
        bandScore: Number(parsed.bandScore) || 5,
        taskAchievement: {
          score: Number(parsed.taskAchievement?.score) || 5,
          feedback: String(parsed.taskAchievement?.feedback || 'No feedback available'),
        },
        coherenceAndCohesion: {
          score: Number(parsed.coherenceAndCohesion?.score) || 5,
          feedback: String(parsed.coherenceAndCohesion?.feedback || 'No feedback available'),
        },
        lexicalResource: {
          score: Number(parsed.lexicalResource?.score) || 5,
          feedback: String(parsed.lexicalResource?.feedback || 'No feedback available'),
        },
        grammaticalRangeAndAccuracy: {
          score: Number(parsed.grammaticalRangeAndAccuracy?.score) || 5,
          feedback: String(parsed.grammaticalRangeAndAccuracy?.feedback || 'No feedback available'),
        },
        overallFeedback: String(parsed.overallFeedback || 'Evaluation completed.'),
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        areasForImprovement: Array.isArray(parsed.areasForImprovement) ? parsed.areasForImprovement : [],
      };
    } catch (error) {
      this.logger.error('Failed to parse Gemini response:', text);
      throw new Error('Failed to parse AI evaluation response');
    }
  }
}
