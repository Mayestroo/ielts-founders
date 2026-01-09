'use client';

interface PartBannerProps {
  partNumber: number;
  startQuestion: number;
  endQuestion: number;
  type: 'READING' | 'LISTENING' | 'WRITING';
  instruction?: string;
}

export function PartBanner({ partNumber, startQuestion, endQuestion, type, instruction: customInstruction }: PartBannerProps) {
  let instruction = '';
  
  if (customInstruction) {
    instruction = customInstruction;
  } else if (type === 'READING') {
    instruction = `Read the text and answer questions ${startQuestion}–${endQuestion}.`;
  } else if (type === 'LISTENING') {
    instruction = `Answer questions ${startQuestion}–${endQuestion}.`;
  } else if (type === 'WRITING') {
    instruction = `Task ${partNumber}`;
  }

  return (
    <div className="w-full px-5 pt-5 pb-2">
      <div className="mx-auto">
        <div className="bg-gray-100 border border-gray-300 rounded-[4px] px-4 py-2.5">
          <h2 className="font-bold text-gray-900 text-[18px] leading-tight mb-1 ">Part {partNumber}</h2>
          <p className="text-gray-900 text-[16px] leading-tight font-normal">{instruction}</p>
        </div>
      </div>
    </div>
  );
}
