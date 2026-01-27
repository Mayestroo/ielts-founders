'use client';

import { Badge, Button, Card, CardBody, ConfirmationModal, Input, Modal, Select, useToast } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { Center, CreateUserForm, Role, User } from '@/types';
import { useEffect, useState } from 'react';

export default function UsersPage() {
  const { user: currentUser, hasRole } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [centers, setCenters] = useState<Center[]>([]);
  
  // Filtering States
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [centerFilter, setCenterFilter] = useState('');

  const [formData, setFormData] = useState<CreateUserForm>({
    username: '',
    password: '',
    firstName: '',
    lastName: '',
    role: currentUser?.role === 'SUPER_ADMIN' ? 'CENTER_ADMIN' : 'TEACHER',
    centerId: currentUser?.centerId || '',
  });

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const skip = (page - 1) * pageSize;
      const { users, total } = await api.getUsers(
        skip, 
        pageSize, 
        searchTerm, 
        roleFilter as Role, 
        centerFilter
      );
      setUsers(users);
      setTotal(total);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Debounce search
    const timer = setTimeout(() => {
      setPage(1); // Reset to page 1 on new filter
      loadUsers();
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, roleFilter, centerFilter]);

  // Handle page changes separately to strict loading
  useEffect(() => {
    loadUsers();
  }, [page]);

  // Removed client-side filtering
  const filteredUsers = users;

  useEffect(() => {
    // Load centers for SuperAdmin to select when creating users
    if (hasRole('SUPER_ADMIN')) {
      api.getCenters().then(setCenters).catch(console.error);
    }
  }, [hasRole]);

  const { success, error: showError } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      if (editingUser) {
        // Prepare update data, omit password if empty
        const updateData: any = { ...formData };
        if (!updateData.password) delete updateData.password;
        
        await api.updateUser(editingUser.id, updateData);
        success('User updated successfully');
      } else {
        await api.createUser(formData);
        success('User created successfully');
      }
      
      setShowModal(false);
      setEditingUser(null);
      setFormData({
        username: '',
        password: '',
        firstName: '',
        lastName: '',
        role: currentUser?.role === 'SUPER_ADMIN' ? 'CENTER_ADMIN' : 'TEACHER',
        centerId: '',
      });
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user');
    }
  };

  const handleEditClick = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '', // Don't show password
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      role: user.role,
      centerId: user.centerId || '',
    });
    setShowModal(true);
  };

  const handleDeleteClick = (id: string) => {
    setUserToDelete(id);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    try {
      await api.deleteUser(userToDelete);
      loadUsers();
      success('User deleted successfully');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setUserToDelete(null);
    }
  };

  const roleOptions = hasRole('SUPER_ADMIN')
    ? [{ value: 'CENTER_ADMIN', label: 'Center Admin' }]
    : [
        { value: 'TEACHER', label: 'Teacher' },
        { value: 'STUDENT', label: 'Student' },
      ];

  const getRoleBadgeVariant = (role: Role) => {
    switch (role) {
      case 'SUPER_ADMIN': return 'danger';
      case 'CENTER_ADMIN': return 'warning';
      case 'TEACHER': return 'info';
      case 'STUDENT': return 'success';
      default: return 'default';
    }
  };



  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
          <p className="text-gray-500 mt-1">Manage users and their roles</p>
        </div>
        <Button onClick={() => {
          setFormData({
            username: '',
            password: '',
            firstName: '',
            lastName: '',
            role: currentUser?.role === 'SUPER_ADMIN' ? 'CENTER_ADMIN' : 'TEACHER',
            centerId: currentUser?.centerId || '',
          });
          setShowModal(true);
        }}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Add User
        </Button>
      </div>

      {/* Filters Bar */}
      <Card className="mb-6">
        <CardBody className="py-4 px-6">
          <div className="flex flex-wrap items-center gap-4">
             <div className="flex-1 min-w-[200px]">
               <Input 
                 placeholder="Search name or username..." 
                 value={searchTerm}
                 onChange={(e) => setSearchTerm(e.target.value)}
                 className="w-full"
               />
             </div>
             <div className="w-48">
               <Select
                 options={[
                   { value: '', label: 'All Roles' },
                   { value: 'CENTER_ADMIN', label: 'Center Admin' },
                   { value: 'TEACHER', label: 'Teacher' },
                   { value: 'STUDENT', label: 'Student' },
                 ]}
                 value={roleFilter}
                 onChange={(e) => setRoleFilter(e.target.value)}
               />
             </div>
             {hasRole('SUPER_ADMIN') && (
               <div className="w-48">
                 <Select
                   options={[
                     { value: '', label: 'All Centers' },
                     ...centers.map(c => ({ value: c.id, label: c.name }))
                   ]}
                   value={centerFilter}
                   onChange={(e) => setCenterFilter(e.target.value)}
                 />
               </div>
             )}
             <Button 
               variant="secondary" 
               onClick={() => {
                 setSearchTerm('');
                 setRoleFilter('');
                 setCenterFilter('');
               }}
             >
               Clear
             </Button>
          </div>
        </CardBody>
      </Card>

      {/* Users Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
        </div>
      ) : (
        <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Center</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                          {user.firstName?.[0] || user.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {user.firstName ? `${user.firstName} ${user.lastName || ''}` : user.username}
                          </p>
                          <p className="text-sm text-gray-500">@{user.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={getRoleBadgeVariant(user.role)}>
                        {user.role.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {user.center?.name || '—'}
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleEditClick(user)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteClick(user.id)}
                        disabled={user.id === currentUser?.id}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                      {searchTerm || roleFilter || centerFilter ? 'No users match your filters' : 'No users found'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex flex-1 justify-between sm:hidden">
            <Button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              variant="secondary"
            >
              Previous
            </Button>
            <Button
              onClick={() => setPage(p => p + 1)}
              disabled={page * pageSize >= total}
              variant="secondary"
            >
              Next
            </Button>
          </div>
          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span> to <span className="font-medium">{Math.min(page * pageSize, total)}</span> of{' '}
                <span className="font-medium">{total}</span> results
              </p>
            </div>
            <div>
              <nav className="isolate inline-flex -space-x-px rounded-md shadow-xs" aria-label="Pagination">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                >
                  <span className="sr-only">Previous</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                  </svg>
                </button>
                {[...Array(Math.ceil(total / pageSize))].map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i + 1)}
                    className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-gray-300 focus:z-20 focus:outline-offset-0 ${
                      page === i + 1
                        ? 'z-10 bg-indigo-600 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'
                        : 'text-gray-900 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page * pageSize >= total}
                  className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                >
                  <span className="sr-only">Next</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                  </svg>
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      <Modal 
        isOpen={showModal} 
        onClose={() => {
          setShowModal(false);
          setEditingUser(null);
          setFormData({
            username: '',
            password: '',
            firstName: '',
            lastName: '',
            role: currentUser?.role === 'SUPER_ADMIN' ? 'CENTER_ADMIN' : 'TEACHER',
            centerId: '',
          });
        }}
        title={editingUser ? "Edit User" : "Create New User"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 text-red-400 text-sm">{error}</div>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="First Name"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            />
            <Input
              label="Last Name"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            />
          </div>

          <Input
            label="Username"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            required
          />


          <Input
            label="Password"
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder={editingUser ? "Leave blank to keep current" : "Enter password"}
            required={!editingUser}
          />

          <Select
            label="Role"
            options={roleOptions}
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value as Role })}
            required
          />

          {hasRole('SUPER_ADMIN') && (
            <Select
              label="Center"
              options={[
                { value: '', label: 'Select a center' },
                ...centers.map(c => ({ value: c.id, label: c.name }))
              ]}
              value={formData.centerId || ''}
              onChange={(e) => setFormData({ ...formData, centerId: e.target.value })}
              required
            />
          )}

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              {editingUser ? "Save Changes" : "Create User"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmationModal
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete User"
        message="Are you sure you want to delete this user? This action cannot be undone."
        confirmText="Delete User"
        variant="danger"
      />
    </div>
  );
}
