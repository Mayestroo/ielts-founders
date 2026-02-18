// Backward compatibility - re-export from examParts.ts
export {
  transformAssignments as transformReadingAssignments,
  getDisplayAssignmentTier,
  isPartAssignmentId,
  getOriginalAssignmentIdFromPartId,
  type DisplayAssignment,
  type PartInfo,
  type ReadingPart,
} from "./examParts";
