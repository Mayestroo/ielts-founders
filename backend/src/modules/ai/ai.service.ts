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
    tasks: { id: string; description: string; response: string }[],
    minTotalWeight: number = 0
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

    let lastEvaluationError: any = null;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      // Add a small delay between tasks to avoid immediate rate limits
      if (i > 0) await this.delay(1000);
      
      try {
        const evaluation = await this.evaluateWritingTask(task.description, task.response);
        taskEvaluations[task.id] = evaluation;

        // Apply standard IELTS weighting
        // Task 1 carries 1/3 weight, Task 2 carries 2/3 weight
        const weight = task.id.toLowerCase().includes('task 2') ? 2 : 1;
        weightedScoreSum += evaluation.bandScore * weight;
        totalWeight += weight;
      } catch (error) {
        lastEvaluationError = error;
        this.logger.error(`Failed to evaluate task ${task.id}:`, error.message || error);
        // Continue to next task to see if others succeed
      }
    }

    if (totalWeight === 0 && tasks.length > 0) {
      this.logger.error('All tasks in section failed evaluation.');
      throw lastEvaluationError || new Error('AI evaluation failed for all tasks');
    }

    // Calculate final band score rounded to nearest 0.5
    let finalBandScore = 0;
    const effectiveTotalWeight = Math.max(totalWeight, minTotalWeight);
    
    if (effectiveTotalWeight > 0) {
      const average = weightedScoreSum / effectiveTotalWeight;
      // Round to nearest 0.5: (round(x * 2) / 2)
      finalBandScore = Math.max(0.0, Math.round(average * 2) / 2);
      this.logger.log(`Calculated section band score: ${finalBandScore} (avg: ${average.toFixed(2)}, totalWeight: ${totalWeight}, effectiveWeight: ${effectiveTotalWeight})`);
    }

    return {
      bandScore: finalBandScore,
      tasks: taskEvaluations,
    };
  }

  // Multi-model fallback strategy
  private readonly models = [
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
    'gemini-2.5-pro',
    'gemini-1.5-pro',
    'gemini-pro-latest',
    'gemini-2.0-flash-exp',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
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

    if (!studentResponse || studentResponse.trim().length < 2) {
       // Return zero evaluation for empty/nearly empty answers
       return {
         bandScore: 0,
         overallFeedback: 'No response provided.',
         strengths: [],
         areasForImprovement: ['Submit a response to receive feedback.'],
         taskAchievement: { score: 0, feedback: 'Did not attempt task.' },
         coherenceAndCohesion: { score: 0, feedback: 'N/A' },
         lexicalResource: { score: 0, feedback: 'N/A' },
         grammaticalRangeAndAccuracy: { score: 0, feedback: 'N/A' }
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
              await this.delay(2000); // Increased to 2s for better rate limit management
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

## Critical Scoring Rules:
- **Band 0**: Award if the response is completely off-topic, consists only of random letters/gibberish (e.g., "sdfjaklsjfa"), or is not in English.
- **Off-topic Penalty**: If the student does not answer the specific question asked, significantly penalize the Task Achievement/Response score.
- **Authenticity**: Check if the meaning makes sense. A string of words that doesn't form coherent sentences should be Band 0 or 1.

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
      const bandScore = Math.max(0.0, Number(parsed.bandScore) || 0.0);
      this.logger.log(`Parsed AI evaluation: Band ${bandScore}`);
      
      return {
        bandScore: bandScore,
        taskAchievement: {
          score: Math.max(0.0, Number(parsed.taskAchievement?.score) || 0.0),
          feedback: String(parsed.taskAchievement?.feedback || 'No feedback available'),
        },
        coherenceAndCohesion: {
          score: Math.max(0.0, Number(parsed.coherenceAndCohesion?.score) || 0.0),
          feedback: String(parsed.coherenceAndCohesion?.feedback || 'No feedback available'),
        },
        lexicalResource: {
          score: Math.max(0.0, Number(parsed.lexicalResource?.score) || 0.0),
          feedback: String(parsed.lexicalResource?.feedback || 'No feedback available'),
        },
        grammaticalRangeAndAccuracy: {
          score: Math.max(0.0, Number(parsed.grammaticalRangeAndAccuracy?.score) || 0.0),
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
