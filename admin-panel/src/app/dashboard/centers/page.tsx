"use client";

import {
    Button,
    Card,
    CardBody,
    ConfirmationModal,
    Input,
    Modal,
    useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { Center } from "@/types";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export default function CentersPage() {
  const [centers, setCenters] = useState<Center[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCenter, setEditingCenter] = useState<Center | null>(null);
  const [name, setName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [logo, setLogo] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [centerToDelete, setCenterToDelete] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { success, error: showError } = useToast();

  const loadCenters = async () => {
    try {
      const data = await api.getCenters();
      setCenters(data);
    } catch (err) {
      console.error("Failed to load centers:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCenters();
  }, []);

  const resetForm = () => {
    setName("");
    setLoginPassword("");
    setLogo("");
    setLogoFile(null);
    setLogoPreview(null);
    setError("");
    setEditingCenter(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (center: Center) => {
    setEditingCenter(center);
    setName(center.name);
    setLoginPassword(center.loginPassword || "");
    setLogo(center.logo || "");
    setLogoPreview(center.logo || null);
    setLogoFile(null);
    setShowModal(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        setError("Please select an image file");
        return;
      }
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      let logoUrl = logo;

      // Upload new logo if selected
      if (logoFile) {
        setIsUploading(true);
        setUploadProgress(0);
        const uploadResult = await api.uploadFile(logoFile, (percent) => {
          setUploadProgress(percent);
        });
        logoUrl = uploadResult.url;
        setIsUploading(false);
        setUploadProgress(0);
      }

      const centerData = {
        name,
        logo: logoUrl || undefined,
        loginPassword: loginPassword || undefined,
      };

      if (editingCenter) {
        await api.updateCenter(editingCenter.id, centerData);
        success("Center updated successfully");
      } else {
        await api.createCenter(centerData);
        success("Center created successfully");
      }

      setShowModal(false);
      resetForm();
      loadCenters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save center");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (id: string) => {
    setCenterToDelete(id);
  };

  const confirmDelete = async () => {
    if (!centerToDelete) return;
    try {
      await api.deleteCenter(centerToDelete);
      loadCenters();
      success("Center deleted successfully");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete center");
    } finally {
      setCenterToDelete(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Learning Centers
          </h1>
          <p className="text-gray-500 mt-1">
            Manage learning centers and their data
          </p>
        </div>
        <Button onClick={openCreateModal}>
          <svg
            className="w-4 h-4 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
          Add Center
        </Button>
      </div>

      {/* Centers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {centers.map((center) => (
          <Card key={center.id} hover>
            <CardBody className="p-6">
              <div className="flex items-start justify-between mb-4">
                {center.logo ? (
                  <div className="w-12 h-12 rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-700">
                    <Image
                      src={center.logo}
                      alt={center.name}
                      width={48}
                      height={48}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-2xl bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg">
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                      />
                    </svg>
                  </div>
                )}
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditModal(center)}
                  >
                    <svg
                      className="w-4 h-4 text-gray-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteClick(center.id)}
                  >
                    <svg
                      className="w-4 h-4 text-red-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </Button>
                </div>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {center.name}
              </h3>
              {center.loginPassword && (
                <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-2 flex items-center gap-1">
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  Password protected
                </p>
              )}
              <div className="flex gap-4 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                  </svg>
                  {center._count?.users || 0} users
                </span>
                <span className="flex items-center gap-1">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  {center._count?.examSections || 0} exams
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-4">
                Created {new Date(center.createdAt).toLocaleDateString()}
              </p>
            </CardBody>
          </Card>
        ))}
        {centers.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-500">
            No centers found. Create your first learning center.
          </div>
        )}
      </div>

      <Modal 
        isOpen={isUploading} 
        onClose={() => {}} 
        title="Uploading Logo..."
      >
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-500">Please wait while the logo is being uploaded</span>
            <span className="font-medium text-indigo-600">{uploadProgress}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div 
              className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" 
              style={{ width: `${uploadProgress}%` }}
            ></div>
          </div>
        </div>
      </Modal>

      {/* Create/Edit Center Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingCenter ? "Edit Center" : "Create New Center"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Center Logo
            </label>
            <div className="flex items-center gap-4">
              <div
                className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center overflow-hidden cursor-pointer hover:border-indigo-500 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {logoPreview ? (
                  <Image
                    src={logoPreview}
                    alt="Logo preview"
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg
                    className="w-8 h-8 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {logoPreview ? "Change Logo" : "Upload Logo"}
                </Button>
                {logoPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-2 text-red-500"
                    onClick={() => {
                      setLogoFile(null);
                      setLogoPreview(null);
                      setLogo("");
                    }}
                  >
                    Remove
                  </Button>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  PNG, JPG up to 10MB
                </p>
              </div>
            </div>
          </div>

          <Input
            label="Center Name"
            placeholder="Enter center name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Input
            label="Center Login Password (Optional)"
            placeholder="Enter password for center access"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            type="password"
          />
          <p className="text-xs text-gray-500 -mt-2">
            If set, users will need this password to access the center
          </p>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving..."
                : editingCenter
                ? "Update Center"
                : "Create Center"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmationModal
        isOpen={!!centerToDelete}
        onClose={() => setCenterToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete Center"
        message="Are you sure you want to delete this center? This will delete all users and exams associated with it. This action cannot be undone."
        confirmText="Delete Center"
        variant="danger"
      />
    </div>
  );
}
