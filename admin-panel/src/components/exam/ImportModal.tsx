'use client';

import { Button, Modal } from '@/components/ui';
import { CreateExamSectionForm } from '@/types';
import { useState } from 'react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: CreateExamSectionForm) => void;
}

export function ImportModal({ isOpen, onClose, onImport }: ImportModalProps) {
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState('');

  const handleImport = () => {
    try {
      setError('');
      if (!jsonInput.trim()) {
        setError('Please paste JSON data');
        return;
      }

      const parsedData = JSON.parse(jsonInput);
      
      // Basic validation of required fields
      if (!parsedData.title || !parsedData.type || !parsedData.duration) {
        setError('Invalid JSON: Missing required fields (title, type, duration)');
        return;
      }

      if (!Array.isArray(parsedData.questions)) {
        setError('Invalid JSON: questions must be an array');
        return;
      }

      onImport(parsedData as CreateExamSectionForm);
      setJsonInput('');
      onClose();
    } catch (err) {
      setError('Invalid JSON format');
    }
  };

  const sampleTemplate = {
    title: "Sample Reading Section",
    type: "READING",
    duration: 60,
    description: "Sample description",
    questions: [
      {
        id: "q-1",
        type: "MCQ_SINGLE",
        questionText: "Which is the correct answer?",
        points: 1,
        imageUrl: "https://example.com/image.png",
        options: [
          { id: "a", text: "Option A" },
          { id: "b", text: "Option B" }
        ],
        correctAnswer: "a"
      }
    ],
    passages: [
      {
        id: "passage-1",
        title: "Section 1",
        content: "Content goes here..."
      }
    ]
  };

  const copyTemplate = () => {
    setJsonInput(JSON.stringify(sampleTemplate, null, 2));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Quick Import Exam Section" width="max-w-2xl">
      <div className="space-y-4">
        <div>
          <p className="text-sm text-gray-500 mb-2">
            Paste your exam section JSON below. You can also 
            <button 
              onClick={copyTemplate}
              className="text-black font-semibold hover:underline ml-1"
            >
              load a sample template
            </button>.
          </p>
          <textarea
            className="w-full h-80 px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 font-mono text-sm resize-none focus:ring-2 focus:ring-black focus:border-transparent outline-none"
            placeholder='{ "title": "...", "type": "...", ... }'
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
          />
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium border border-red-100">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleImport} className="flex-1 bg-black text-white hover:bg-gray-800">
            Import Section
          </Button>
        </div>
      </div>
    </Modal>
  );
}
