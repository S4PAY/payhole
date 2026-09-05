import AsyncStorage from "@react-native-async-storage/async-storage";

import type { KeyValueStorage } from "./settings";

/** AsyncStorage narrowed to the two calls the settings code uses. */
export const storage: KeyValueStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};
