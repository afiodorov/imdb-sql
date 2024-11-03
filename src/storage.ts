import { Dispatch, SetStateAction } from "react";

export function useLocalStorageSetter<S extends { toString(): string }>(
  setter: Dispatch<SetStateAction<S>>,
  key: string,
  useJson = true
): Dispatch<SetStateAction<S>> {
  return (newValue: S | ((prevState: S) => S)) => {
    if (typeof newValue === "function") {
      setter((prevState: S) => {
        const resolvedValue = (newValue as Function)(prevState);
        let v: string;
        if (useJson) {
          v = JSON.stringify(resolvedValue);
        } else {
          v = resolvedValue.toString();
        }

        localStorage.setItem(key, v);
        return resolvedValue;
      });
    } else {
      let v: string;
      if (useJson) {
        v = JSON.stringify(newValue);
      } else {
        v = newValue.toString();
      }
      localStorage.setItem(key, v);
      setter(newValue);
    }
  };
}

export default useLocalStorageSetter;
