import { QueryClient } from "@tanstack/react-query";
import { studentQueryDefaults } from "./config";

export const createStudentQueryClient = () =>
  new QueryClient({
    defaultOptions: studentQueryDefaults,
  });
