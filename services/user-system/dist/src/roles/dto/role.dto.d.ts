export declare class CreateRoleDto {
    name: string;
    code: string;
    description?: string;
}
export declare class UpdateRoleDto {
    name?: string;
    description?: string;
}
export declare class AssignPermissionsDto {
    permissionIds: string[];
}
