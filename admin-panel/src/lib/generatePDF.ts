'use client';

import { ExamResult, User } from '@/types';
import { jsPDF } from 'jspdf';

interface StudentReportData {
  student: User;
  results: {
    listening?: ExamResult;
    reading?: ExamResult;
    writing?: ExamResult;
    speaking?: ExamResult;
  };
  centerName?: string;
  testDate: string;
}

interface LoadedImage {
  base64: string;
  width: number;
  height: number;
  ratio: number;
}

interface JsPdfWithGState {
  GState?: new (settings: { opacity: number }) => unknown;
  setGState?: (state: unknown) => void;
}

const CERTIFICATE_TITLE = 'English Proficiency Mock Test';
const REPORT_TITLE = 'Performance Report';
const DISCLAIMER_TEXT =
  'THIS IS NOT AN IELTS CERTIFICATE.\nNOT VALID FOR UNIVERSITIES OR VISA PURPOSES.';

async function loadImage(url: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      // Scale down large images to max 1000px width/height to save space
      const maxDim = 1000;
      let width = img.width;
      let height = img.height;
      
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (height / width) * maxDim;
          width = maxDim;
        } else {
          width = (width / height) * maxDim;
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve({
        base64: canvas.toDataURL('image/png'),
        width: width,
        height: height,
        ratio: width / height
      });
    };
    img.onerror = reject;
    img.src = url;
  });
}

function getCEFR(bandScore: number): string {
  if (bandScore >= 8.5) return 'C2';
  if (bandScore >= 7.0) return 'C1';
  if (bandScore >= 5.5) return 'B2';
  if (bandScore >= 4.0) return 'B1';
  if (bandScore >= 3.0) return 'A2';
  return 'A1';
}


async function drawReportPage(doc: jsPDF, data: StudentReportData, logoData: LoadedImage | null) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - 2 * margin;

  doc.setLineWidth(0.05);

  // Colors & Styles
  const darkGray = [30, 30, 30] as [number, number, number];
  const lightGray = [240, 240, 240] as [number, number, number];
  const borderColor = [50, 50, 50] as [number, number, number];

  // Helper for drawing boxed fields
  const drawField = (x: number, y: number, w: number, h: number, label: string, value: string, shaded = false) => {
    if (shaded) {
      doc.setFillColor(...lightGray);
      doc.rect(x, y, w, h, 'F');
    }
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.05);
    doc.rect(x, y, w, h);
    
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...darkGray);
    doc.text(label, x - 2, y + h/2 + 1, { align: 'right' });
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(String(value).toUpperCase(), x + 3, y + h/2 + 2);
  };

  const drawScoreBox = (x: number, y: number, label: string, score: string | number) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkGray);
    doc.text(label, x + 8, y - 4, { align: 'center' });
    
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.05);
    doc.rect(x, y, 16, 16);
    
    doc.setFontSize(11);
    doc.text(String(score), x + 8, y + 10, { align: 'center' });
  };

  // 1. Watermark
  if (logoData) {
    const docWithGState = doc as jsPDF & JsPdfWithGState;

    if (docWithGState.GState && typeof docWithGState.setGState === 'function') {
      docWithGState.setGState(new docWithGState.GState({ opacity: 0.04 }));
    }
    const watermarkWidth = 120;
    const watermarkHeight = watermarkWidth / logoData.ratio;
    doc.addImage(logoData.base64, 'PNG', (pageWidth - watermarkWidth)/2, (pageHeight - watermarkHeight)/2, watermarkWidth, watermarkHeight);

    if (docWithGState.GState && typeof docWithGState.setGState === 'function') {
      docWithGState.setGState(new docWithGState.GState({ opacity: 1 }));
    }
  }

  let y = 15;

  // 2. Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(CERTIFICATE_TITLE, margin, y + 9);

  // ACADEMIC Box
  doc.setFontSize(11);
  doc.rect(pageWidth - margin - 60, y, 60, 8);
  doc.text('ACADEMIC', pageWidth - margin - 30, y + 6, { align: 'center' });

  y += 22;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(REPORT_TITLE, margin, y);

  y += 5;
  doc.setFillColor(255, 233, 233);
  doc.setDrawColor(180, 0, 0);
  doc.setLineWidth(0.4);
  doc.rect(margin, y, contentWidth, 18, 'FD');

  doc.setTextColor(180, 0, 0);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(DISCLAIMER_TEXT, pageWidth / 2, y + 6, {
    align: 'center',
    maxWidth: contentWidth - 6,
  });

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.05);

  y += 22;
  doc.line(margin, y, pageWidth - margin, y);

  // 3. Info Bar
  y += 6;
  doc.setFontSize(8);
  doc.text('Centre Name', margin, y + 5);
  doc.rect(margin + 20, y, 60, 8);
  doc.setFont('helvetica', 'bold');
  doc.text('Founders English School', margin + 50, y + 5.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.text('Date', margin + 85, y + 5);
  doc.rect(margin + 93, y, 30, 8);
  doc.setFont('helvetica', 'bold');
  const formattedDate = new Date(data.testDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '/').toUpperCase();
  doc.text(formattedDate, margin + 108, y + 5.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.text('Candidate Number', margin + 128, y + 5);
  doc.rect(margin + 155, y, 25, 8);
  doc.setFont('helvetica', 'bold');
  doc.text('', margin + 167.5, y + 5.5, { align: 'center' });

  y += 12;
  doc.line(margin, y, pageWidth - margin, y);

  // 4. Candidate Details
  y += 8;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Candidate Details', margin, y);

  y += 5;
  const fieldH = 10;
  const labelX = margin + 25;
  const fieldW = contentWidth - 45;

  drawField(labelX, y, fieldW, fieldH, 'Family Name', data.student.lastName || data.student.username, true);
  y += fieldH + 2;
  drawField(labelX, y, fieldW, fieldH, 'First Name(s)', data.student.firstName || '', true);
  y += fieldH + 2;
  drawField(labelX, y, fieldW, 8, 'Candidate ID', '', true);

  y += 12;
  doc.line(margin, y, pageWidth - margin, y);

  // 5. Test Results
  y += 8;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Test Results', margin, y);

  y += 12;
  const lScore = data.results.listening?.bandScore || 0;
  const rScore = data.results.reading?.bandScore || 0;
  const wScore = data.results.writing?.bandScore || 0;
  const sScore = data.results.speaking?.bandScore || 0;
  
  const bandScores = [lScore, rScore, wScore, sScore].filter(s => s > 0);
  const overallBand = bandScores.length > 0 ? Math.round((bandScores.reduce((a, b) => a + b, 0) / bandScores.length) * 2) / 2 : 0;
  
  const boxWidth = 16;
  const numBoxes = 6;
  const gap = (contentWidth - (numBoxes * boxWidth)) / (numBoxes + 1);
  let currentX = margin + gap;

  drawScoreBox(currentX, y, 'Listening', lScore);
  currentX += boxWidth + gap;
  drawScoreBox(currentX, y, 'Reading', rScore);
  currentX += boxWidth + gap;
  drawScoreBox(currentX, y, 'Writing', wScore);
  currentX += boxWidth + gap;
  drawScoreBox(currentX, y, 'Speaking', sScore);
  currentX += boxWidth + gap;
  drawScoreBox(currentX, y, 'Overall Band\nScore', overallBand);
  currentX += boxWidth + gap;
  drawScoreBox(currentX, y, 'CEFR\nLevel', getCEFR(overallBand));

  y += 25;
  doc.line(margin, y, pageWidth - margin, y);

  // 6. Administrator Comments
  y += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Administrator Comments', margin, y);
  
  y += 4;
  doc.rect(margin, y, 100, 35);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('Verified by AI Assessment Engine.', margin + 2, y + 5);

  // 7. Validation Stamp
  doc.rect(margin + 105, y, 35, 35);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('For institutional\nverification only.\nPlease contact\nFounders English School', margin + 122.5, y + 10, { align: 'center' });

  doc.rect(pageWidth - margin - 35, y, 35, 35);
  doc.text('Validation stamp', pageWidth - margin - 17.5, y - 2, { align: 'center' });
  
  doc.setDrawColor(200, 0, 0);
  doc.circle(pageWidth - margin - 17.5, y + 17.5, 12);
  doc.setFontSize(6);
  doc.setTextColor(200, 0, 0);
  doc.text('THIS IS NOT', pageWidth - margin - 17.5, y + 16, { align: 'center' });
  doc.text('OFFICIAL TEST', pageWidth - margin - 17.5, y + 20, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  y += 50;
  doc.setFontSize(9);
  doc.text('Date', margin + 65, y + 5);
  doc.rect(margin + 75, y, 30, 8);
  const reportDate = new Date().toLocaleDateString('en-GB');
  doc.text(reportDate, margin + 90, y + 5.5, { align: 'center' });

  doc.text('Performance\nReport Number', margin + 115, y + 3);
  doc.setFillColor(230, 230, 230);
  doc.rect(margin + 140, y, 45, 8, 'F');
  doc.rect(margin + 140, y, 45, 8);

  // 8. Footer Logo
  if (logoData) {
    try {
      const footerLogoHeight = 15;
      const footerLogoWidth = footerLogoHeight * logoData.ratio;
      const footerLogoX = (pageWidth - footerLogoWidth) / 2;
      doc.addImage(logoData.base64, 'PNG', footerLogoX, y + 30, footerLogoWidth, footerLogoHeight);
    } catch (e) {
      console.warn('Could not add footer logo:', e);
    }
  }
}

export async function generateResultPDF(data: StudentReportData) {
  const doc = new jsPDF({ compress: true });
  const logoUrl = '/logo.png';
  let logoData: LoadedImage | null = null;
  try {
    logoData = await loadImage(logoUrl);
  } catch {}

  await drawReportPage(doc, data, logoData);

  const formattedDate = new Date(data.testDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-').toUpperCase();
  const namePart = `${data.student.firstName || ''}_${data.student.lastName || ''}`.trim().replace(/\s+/g, '_').toUpperCase() || data.student.username.toUpperCase();
  const fileName = `English_Proficiency_Mock_Test_${namePart}_${formattedDate}.pdf`;
  doc.save(fileName);
}

export async function generateBatchPDF(reports: StudentReportData[]) {
  const doc = new jsPDF({ compress: true });
  const logoUrl = '/logo.png';
  let logoData: LoadedImage | null = null;
  try {
    logoData = await loadImage(logoUrl);
  } catch {}

  for (let i = 0; i < reports.length; i++) {
    if (i > 0) doc.addPage();
    await drawReportPage(doc, reports[i], logoData);
  }

  const dateStr = new Date().toISOString().split('T')[0];
  
  if (reports.length === 1) {
    const data = reports[0];
    const formattedDate = new Date(data.testDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-').toUpperCase();
    const namePart = `${data.student.firstName || ''}_${data.student.lastName || ''}`.trim().replace(/\s+/g, '_').toUpperCase() || data.student.username.toUpperCase();
    doc.save(`English_Proficiency_Mock_Test_${namePart}_${formattedDate}.pdf`);
  } else {
    doc.save(`English_Proficiency_Mock_Test_Batch_Report_${dateStr}.pdf`);
  }
}

export function calculateOverallBand(results: ExamResult[]): number {
  if (results.length === 0) return 0;
  const sum = results.reduce((acc, r) => acc + (r.bandScore || 0), 0);
  return Math.round((sum / results.length) * 2) / 2;
}
