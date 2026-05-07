import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./index";

export function useAppDispatch(): AppDispatch {
  return useDispatch<AppDispatch>();
}
export const useAppSelector = useSelector.withTypes<RootState>();

