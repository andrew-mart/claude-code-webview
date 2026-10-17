// Chrome's permissions for a page to reach this computer's apps (Local Network Access), which TypeScript's DOM types do
// not know yet: loopback-network from Chrome 145 on, local-network-access in Chrome 142–144.
interface Permissions {
  query(permissionDesc: { name: 'loopback-network' | 'local-network-access' }): Promise<PermissionStatus>;
}
