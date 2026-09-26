"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const v1_1 = require("@neon/config/v1");
exports.default = (0, v1_1.defineConfig)({
    auth: false,
    branch: (branch) => {
        if (branch.isDefault) {
            return {};
        }
        if (!branch.exists) {
            return { ttl: "7d" };
        }
        return {};
    },
});
//# sourceMappingURL=neon.js.map