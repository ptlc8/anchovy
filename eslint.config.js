import globals from "globals";
import pluginJs from "@eslint/js";

export default [
    {
        files: ["src/**/*"],
        languageOptions: {
            globals: globals.browser
        }
    },
    pluginJs.configs.recommended,
    {
        files: ["**/*.js"],
        rules: {
            "no-unused-vars": "off"
        }
    }
];