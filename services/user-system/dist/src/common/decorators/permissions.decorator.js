"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Permissions = exports.PERMISSION_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.PERMISSION_KEY = 'permission';
const Permissions = (code) => (0, common_1.SetMetadata)(exports.PERMISSION_KEY, code);
exports.Permissions = Permissions;
//# sourceMappingURL=permissions.decorator.js.map