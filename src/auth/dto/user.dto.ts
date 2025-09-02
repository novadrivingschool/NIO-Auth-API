export class UserDto {
    id: string;
    email: string;
    roles: string[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    // Perfil opcional:
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
}