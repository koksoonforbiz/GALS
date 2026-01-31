import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../components/Toast';
import GenerateStructureWizard from '../../components/GenerateStructureWizard';
import SourceSelector from '../../components/SourceSelector';
import PromptComposerModal, { GenerateConfig } from '../../components/PromptComposerModal';
import BulkProgressPanel from '../../components/BulkProgressPanel';
import RichTextEditor from '../../components/editor/RichTextEditor';

// ─── Types ──────────────────────────────────────────────

interface ModuleItem {
  id: string;
  moduleId: string;
  type: 'PAGE' | 'PDF' | 'LINK' | 'ASSESSMENT';
  title: string;
  orderIndex: number;
  contentMdx: string | null;
  pdfBlobKey: string | null;
  pdfFilename: string | null;
  pdfSize: number | null;
  url: string | null;
  assessmentId: string | null;
}

interface CourseModule {
  id: string;
  courseId: string;
  title: string;
  orderIndex: number;
  items: ModuleItem[];
}

interface Course {
  id: string;
  title: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED';
  visibility: 'PUBLIC' | 'PRIVATE';
  bannerBlobKey: string | null;
  modules: CourseModule[];
  _count: { enrollments: number; topics: number; modules: number };
}

interface SourceDocument {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  chunkCount: number;
  chunkingStrategy: string;
  processingStatus: string | null;
  processingPct: number | null;
  errorMessage: string | null;
  indexedAt: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string };
}

type TabKey = 'overview' | 'content' | 'sources' | 'settings';

// ─── Component ──────────────────────────────────────────

export function CourseBuilderPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [showStructureWizard, setShowStructureWizard] = useState(false);

  // Overview form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PRIVATE');
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Content tab state
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [addingModule, setAddingModule] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);

  // Add item state
  const [addItemType, setAddItemType] = useState<ModuleItem['type'] | ''>('');
  const [addItemTitle, setAddItemTitle] = useState('');
  const [addItemUrl, setAddItemUrl] = useState('');
  const [addItemContent, setAddItemContent] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  // Edit item state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // AI Content Generation state
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [showPromptComposer, setShowPromptComposer] = useState(false);
  const [showSourcePanel, setShowSourcePanel] = useState(false);
  const [strictSources, setStrictSources] = useState(true);
  const [scopePreference, setScopePreference] = useState<
    'module_only' | 'module_then_course' | 'course_only'
  >('module_then_course');
  const [bulkResults, setBulkResults] = useState<Array<{
    pageId: string;
    status: 'OK' | 'NOT_ENOUGH_INFO' | 'ERROR' | 'PENDING' | 'RUNNING';
    jobId?: string;
    message?: string;
    missingInfo?: string[];
  }> | null>(null);
  const [generating, setGenerating] = useState(false);

  // Sources tab state
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const fetchDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const docs = await apiFetch<SourceDocument[]>(`/courses/${courseId}/documents`);
      setDocuments(docs);
    } catch {
      // silently fail - documents tab may not be active
    } finally {
      setLoadingDocs(false);
    }
  }, [courseId]);

  const handleDocUpload = async (file: File) => {
    setUploadingDoc(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/courses/${courseId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      toast('success', `Uploaded "${file.name}"`);
      fetchDocuments();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!confirm('Delete this document and all its chunks?')) return;
    try {
      await apiFetch(`/documents/${docId}`, { method: 'DELETE' });
      toast('success', 'Document deleted');
      fetchDocuments();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleRechunk = async (docId: string) => {
    try {
      await apiFetch(`/documents/${docId}/rechunk`, { method: 'POST' });
      toast('info', 'Re-chunking started...');
      fetchDocuments();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Re-chunking failed');
      fetchDocuments();
    }
  };

  const fetchCourse = useCallback(async () => {
    try {
      const data = await apiFetch<Course>(`/courses/${courseId}`);
      setCourse(data);
      setTitle(data.title);
      setDescription(data.description);
      setVisibility(data.visibility);
      if (data.modules.length > 0 && !selectedModuleId) {
        setSelectedModuleId(data.modules[0]!.id);
      }
    } catch {
      toast('error', 'Failed to load course');
      navigate('/teacher/courses');
    } finally {
      setLoading(false);
    }
  }, [courseId, navigate, toast, selectedModuleId]);

  useEffect(() => {
    fetchCourse();
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'sources') fetchDocuments();
  }, [activeTab, fetchDocuments]);

  // Poll for progress while any document is still processing
  useEffect(() => {
    const hasProcessing = documents.some((d) => !d.indexedAt && !d.errorMessage);
    if (!hasProcessing || activeTab !== 'sources') return;

    const interval = setInterval(() => {
      fetchDocuments();
    }, 2000);
    return () => clearInterval(interval);
  }, [documents, activeTab, fetchDocuments]);

  // ─── Autosave for Overview (debounced) ──────────────────

  const autosave = useCallback(
    async (data: { title?: string; description?: string; visibility?: string }) => {
      setSaving(true);
      try {
        await apiFetch(`/courses/${courseId}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });
      } catch {
        toast('error', 'Failed to save');
      } finally {
        setSaving(false);
      }
    },
    [courseId, toast],
  );

  const debounceSave = useCallback(
    (data: { title?: string; description?: string; visibility?: string }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => autosave(data), 1500);
    },
    [autosave],
  );

  const handleTitleChange = (val: string) => {
    setTitle(val);
    debounceSave({ title: val });
  };

  const handleDescriptionChange = (val: string) => {
    setDescription(val);
    debounceSave({ description: val });
  };

  const handleVisibilityChange = (val: 'PUBLIC' | 'PRIVATE') => {
    setVisibility(val);
    autosave({ visibility: val });
  };

  // ─── Module operations ─────────────────────────────────

  const handleAddModule = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingModule(true);
    try {
      const mod = await apiFetch<CourseModule>(`/courses/${courseId}/modules`, {
        method: 'POST',
        body: JSON.stringify({ title: newModuleTitle }),
      });
      setNewModuleTitle('');
      setSelectedModuleId(mod.id);
      toast('success', 'Module added');
      fetchCourse();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to add module');
    } finally {
      setAddingModule(false);
    }
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (!confirm('Delete this module and all its items?')) return;
    try {
      await apiFetch(`/courses/${courseId}/modules/${moduleId}`, { method: 'DELETE' });
      if (selectedModuleId === moduleId) setSelectedModuleId(null);
      toast('success', 'Module deleted');
      fetchCourse();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to delete module');
    }
  };

  // ─── Item operations ───────────────────────────────────

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModuleId || !addItemType) return;
    setAddingItem(true);
    try {
      const body: Record<string, unknown> = {
        type: addItemType,
        title: addItemTitle,
      };
      if (addItemType === 'PAGE') body.contentMdx = addItemContent;
      if (addItemType === 'LINK') body.url = addItemUrl;

      await apiFetch(`/modules/${selectedModuleId}/items`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAddItemType('');
      setAddItemTitle('');
      setAddItemUrl('');
      setAddItemContent('');
      toast('success', 'Item added');
      fetchCourse();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to add item');
    } finally {
      setAddingItem(false);
    }
  };

  const handleDeleteItem = async (itemId: string, moduleId: string) => {
    try {
      await apiFetch(`/modules/${moduleId}/items/${itemId}`, { method: 'DELETE' });
      toast('success', 'Item deleted');
      fetchCourse();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  const handleSaveItemContent = async (itemId: string, moduleId: string, html?: string) => {
    try {
      await apiFetch(`/modules/${moduleId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ contentMdx: html ?? editContent }),
      });
      // Only close editor and show toast for manual saves (no html param)
      if (html === undefined) {
        setEditingItemId(null);
        toast('success', 'Content saved');
        fetchCourse();
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to save');
    }
  };

  // PDF upload
  const handlePdfUpload = async (itemId: string, _moduleId: string, file: File) => {
    try {
      // Get presigned upload URL
      const { url } = await apiFetch<{ url: string; key: string }>(`/items/${itemId}/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, size: file.size }),
      });

      // Upload directly to MinIO
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      });

      toast('success', `Uploaded "${file.name}"`);
      fetchCourse();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const handlePdfDownload = async (itemId: string) => {
    try {
      const { url, filename } = await apiFetch<{ url: string; filename: string }>(
        `/items/${itemId}/download-url`,
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || 'document.pdf';
      link.target = '_blank';
      link.click();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Download failed');
    }
  };

  // ─── Settings ──────────────────────────────────────────

  const handleDuplicate = async () => {
    try {
      await apiFetch(`/courses/${courseId}/duplicate`, { method: 'POST' });
      toast('success', 'Course duplicated');
      navigate('/teacher/courses');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to duplicate');
    }
  };

  const handleArchive = async () => {
    if (!confirm('Archive this course?')) return;
    try {
      await apiFetch(`/courses/${courseId}`, { method: 'DELETE' });
      toast('success', 'Course archived');
      navigate('/teacher/courses');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to archive');
    }
  };

  // ─── AI Content Generation ─────────────────────────────

  const togglePageSelection = (pageId: string) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  const selectAllPages = () => {
    if (!selectedModule) return;
    const pageItems = selectedModule.items.filter((i) => i.type === 'PAGE');
    setSelectedPageIds(new Set(pageItems.map((i) => i.id)));
  };

  const clearPageSelection = () => setSelectedPageIds(new Set());

  const openPromptComposer = (pageIds?: string[]) => {
    if (pageIds) {
      setSelectedPageIds(new Set(pageIds));
    }
    setShowPromptComposer(true);
  };

  const handleAIGenerate = async (config: GenerateConfig) => {
    if (!courseId || !selectedModuleId) return;
    setShowPromptComposer(false);
    setGenerating(true);

    const pageIds = Array.from(selectedPageIds);

    // Initialize progress
    setBulkResults(pageIds.map((id) => ({ pageId: id, status: 'PENDING' })));

    try {
      if (pageIds.length === 1) {
        // Single page
        setBulkResults([{ pageId: pageIds[0]!, status: 'RUNNING' }]);
        const res = await apiFetch<{
          pageId: string;
          status: 'OK' | 'NOT_ENOUGH_INFO' | 'ERROR';
          jobId?: string;
          message?: string;
          missingInfo?: string[];
        }>(`/admin/pages/${pageIds[0]}/generate-content`, {
          method: 'POST',
          body: JSON.stringify({
            courseId,
            moduleId: selectedModuleId,
            selectedSourceIds: config.selectedSourceIds,
            strictSources: config.strictSources,
            scopePreference: config.scopePreference,
            adminPrompt: config.adminPrompt,
          }),
        });
        setBulkResults([res]);
        if (res.status === 'OK') {
          toast('success', 'Content generated successfully');
          fetchCourse();
        }
      } else {
        // Batch
        setBulkResults(pageIds.map((id) => ({ pageId: id, status: 'RUNNING' })));
        const res = await apiFetch<{
          batchJobId: string;
          results: Array<{
            pageId: string;
            status: 'OK' | 'NOT_ENOUGH_INFO' | 'ERROR';
            jobId?: string;
            message?: string;
            missingInfo?: string[];
          }>;
        }>('/admin/pages/generate-content-batch', {
          method: 'POST',
          body: JSON.stringify({
            courseId,
            moduleId: selectedModuleId,
            pageIds,
            selectedSourceIds: config.selectedSourceIds,
            strictSources: config.strictSources,
            scopePreference: config.scopePreference,
            adminPrompt: config.adminPrompt,
          }),
        });
        setBulkResults(res.results);
        const okCount = res.results.filter((r) => r.status === 'OK').length;
        if (okCount > 0) {
          toast('success', `Generated content for ${okCount}/${res.results.length} page(s)`);
          fetchCourse();
        }
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Generation failed');
      setBulkResults(
        pageIds.map((id) => ({
          pageId: id,
          status: 'ERROR' as const,
          message: err instanceof Error ? err.message : 'Generation failed',
        })),
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleRetryFailed = (failedPageIds: string[]) => {
    setSelectedPageIds(new Set(failedPageIds));
    setShowPromptComposer(true);
  };

  // ─── Render ────────────────────────────────────────────

  if (loading || !course) {
    return <div className="text-gray-500">Loading course...</div>;
  }

  const selectedModule = course.modules.find((m) => m.id === selectedModuleId);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'content', label: 'Content' },
    { key: 'sources', label: 'Sources' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/teacher/courses')}
            className="text-gray-500 hover:text-gray-700"
          >
            &larr; Back
          </button>
          <h2 className="text-2xl font-bold text-gray-900">{course.title}</h2>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              course.status === 'PUBLISHED'
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {course.status}
          </span>
          {saving && <span className="text-xs text-gray-400">Saving...</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Overview Tab ─── */}
      {activeTab === 'overview' && (
        <div className="max-w-2xl space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={4}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => handleVisibilityChange(e.target.value as 'PUBLIC' | 'PRIVATE')}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="PRIVATE">Private</option>
              <option value="PUBLIC">Public</option>
            </select>
          </div>
          <div className="pt-2 text-sm text-gray-500">
            <p>
              {course._count.modules} module(s) | {course._count.topics} topic(s) |{' '}
              {course._count.enrollments} student(s) enrolled
            </p>
          </div>

          {/* AI Structure Generation */}
          <div className="mt-6 p-4 bg-violet-50 border border-violet-200 rounded-lg">
            <h4 className="text-sm font-semibold text-violet-900 mb-1">
              AI Course Structure Generator
            </h4>
            <p className="text-sm text-violet-700 mb-3">
              Automatically generate topics, subtopics, and lesson modules from your uploaded
              curriculum documents using AI.
            </p>
            <button
              onClick={() => setShowStructureWizard(true)}
              className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700"
            >
              Generate Course Structure
            </button>
          </div>
        </div>
      )}

      {/* Structure Generation Wizard Modal */}
      {showStructureWizard && course && (
        <GenerateStructureWizard
          courseId={course.id}
          courseTitle={course.title}
          onClose={() => setShowStructureWizard(false)}
          onApplied={() => {
            fetchCourse();
            setShowStructureWizard(false);
          }}
          toast={toast}
        />
      )}

      {/* ─── Content Tab ─── */}
      {activeTab === 'content' && (
        <div className="flex gap-6">
          {/* Left panel: Modules list */}
          <div className="w-64 shrink-0">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Modules</h3>
            <div className="space-y-1 mb-3">
              {course.modules.map((mod) => (
                <div
                  key={mod.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                    selectedModuleId === mod.id
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'hover:bg-gray-50 text-gray-700'
                  }`}
                  onClick={() => setSelectedModuleId(mod.id)}
                >
                  <span className="truncate">{mod.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteModule(mod.id);
                    }}
                    className="text-gray-400 hover:text-red-500 text-xs ml-2"
                    title="Delete module"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <form onSubmit={handleAddModule} className="flex gap-1">
              <input
                type="text"
                value={newModuleTitle}
                onChange={(e) => setNewModuleTitle(e.target.value)}
                placeholder="New module..."
                className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
              <button
                type="submit"
                disabled={addingModule}
                className="px-2 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                +
              </button>
            </form>
          </div>

          {/* Right panel: Module items */}
          <div className="flex-1 min-w-0">
            {selectedModule ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Items in &quot;{selectedModule.title}&quot;
                  </h3>
                </div>

                {/* AI Generation Toolbar */}
                {selectedModule.items.filter((i) => i.type === 'PAGE').length > 0 && (
                  <div className="mb-3 p-3 bg-violet-50 border border-violet-200 rounded-lg">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        {/* Select all / clear */}
                        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={
                              selectedModule.items.filter((i) => i.type === 'PAGE').length > 0 &&
                              selectedModule.items
                                .filter((i) => i.type === 'PAGE')
                                .every((i) => selectedPageIds.has(i.id))
                            }
                            onChange={(e) =>
                              e.target.checked ? selectAllPages() : clearPageSelection()
                            }
                            className="rounded border-gray-300 text-violet-600"
                          />
                          Select all pages
                        </label>

                        {selectedPageIds.size > 0 && (
                          <span className="text-xs font-medium text-violet-700">
                            {selectedPageIds.size} selected
                          </span>
                        )}

                        {selectedPageIds.size > 0 && (
                          <button
                            onClick={clearPageSelection}
                            className="text-xs text-gray-500 hover:text-gray-700 underline"
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Source selection toggle */}
                        <button
                          onClick={() => setShowSourcePanel(!showSourcePanel)}
                          className="text-xs px-2 py-1 bg-white border border-violet-200 text-violet-700 rounded hover:bg-violet-100"
                        >
                          Sources ({selectedSourceIds.size})
                        </button>

                        {/* Scope dropdown */}
                        <select
                          value={scopePreference}
                          onChange={(e) => setScopePreference(e.target.value as any)}
                          className="text-xs px-1.5 py-1 border border-violet-200 rounded bg-white text-gray-600"
                        >
                          <option value="module_only">Module only</option>
                          <option value="module_then_course">Module + course</option>
                          <option value="course_only">Course only</option>
                        </select>

                        {/* Strict toggle */}
                        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={strictSources}
                            onChange={(e) => setStrictSources(e.target.checked)}
                            className="rounded border-gray-300 text-violet-600 w-3.5 h-3.5"
                          />
                          Strict
                        </label>

                        {/* Generate button */}
                        <button
                          onClick={() => openPromptComposer()}
                          disabled={selectedPageIds.size === 0 || generating}
                          className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {generating ? 'Generating...' : 'Generate AI Content'}
                        </button>
                      </div>
                    </div>

                    {/* Source selection panel (inline) */}
                    {showSourcePanel && courseId && (
                      <div className="mt-2 pt-2 border-t border-violet-200">
                        <SourceSelector
                          courseId={courseId}
                          selectedSourceIds={selectedSourceIds}
                          onSelectionChange={setSelectedSourceIds}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Bulk progress panel */}
                {bulkResults && (
                  <div className="mb-3">
                    <BulkProgressPanel
                      results={bulkResults}
                      pageTitles={Object.fromEntries(
                        selectedModule.items.map((i) => [i.id, i.title]),
                      )}
                      onRetryFailed={handleRetryFailed}
                      onClose={() => setBulkResults(null)}
                    />
                  </div>
                )}

                {/* Items list */}
                <div className="space-y-2 mb-4">
                  {selectedModule.items.length === 0 ? (
                    <p className="text-sm text-gray-400">No items yet. Add one below.</p>
                  ) : (
                    selectedModule.items.map((item) => (
                      <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {/* Page selection checkbox */}
                            {item.type === 'PAGE' && (
                              <input
                                type="checkbox"
                                checked={selectedPageIds.has(item.id)}
                                onChange={() => togglePageSelection(item.id)}
                                className="rounded border-gray-300 text-violet-600 w-3.5 h-3.5"
                              />
                            )}
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                item.type === 'PAGE'
                                  ? 'bg-blue-100 text-blue-700'
                                  : item.type === 'PDF'
                                    ? 'bg-red-100 text-red-700'
                                    : item.type === 'LINK'
                                      ? 'bg-purple-100 text-purple-700'
                                      : 'bg-green-100 text-green-700'
                              }`}
                            >
                              {item.type}
                            </span>
                            <span className="text-sm font-medium text-gray-800">{item.title}</span>
                            {item.type === 'PAGE' && item.contentMdx && (
                              <span className="text-[10px] px-1 py-0.5 bg-green-100 text-green-600 rounded">
                                has content
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {/* AI Generate button per page */}
                            {item.type === 'PAGE' && (
                              <button
                                onClick={() => openPromptComposer([item.id])}
                                disabled={generating}
                                className="text-xs px-2 py-1 bg-violet-100 text-violet-700 rounded hover:bg-violet-200 disabled:opacity-50"
                                title="Generate AI content for this page"
                              >
                                AI
                              </button>
                            )}
                            {item.type === 'PAGE' && (
                              <button
                                onClick={() => {
                                  if (editingItemId === item.id) {
                                    setEditingItemId(null);
                                  } else {
                                    setEditingItemId(item.id);
                                    setEditContent(item.contentMdx || '');
                                  }
                                }}
                                className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                              >
                                {editingItemId === item.id ? 'Cancel' : 'Edit'}
                              </button>
                            )}
                            {item.type === 'PDF' && item.pdfBlobKey && (
                              <button
                                onClick={() => handlePdfDownload(item.id)}
                                className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                              >
                                Preview
                              </button>
                            )}
                            {item.type === 'PDF' && (
                              <label className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 cursor-pointer">
                                Upload
                                <input
                                  type="file"
                                  accept="application/pdf"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handlePdfUpload(item.id, item.moduleId, file);
                                  }}
                                />
                              </label>
                            )}
                            <button
                              onClick={() => handleDeleteItem(item.id, item.moduleId)}
                              className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {/* PDF info */}
                        {item.type === 'PDF' && item.pdfFilename && (
                          <p className="text-xs text-gray-500 mt-1">
                            {item.pdfFilename} (
                            {item.pdfSize ? `${Math.round(item.pdfSize / 1024)}KB` : 'unknown size'}
                            )
                          </p>
                        )}

                        {/* LINK info */}
                        {item.type === 'LINK' && item.url && (
                          <p className="text-xs text-gray-500 mt-1 truncate">{item.url}</p>
                        )}

                        {/* PAGE editor */}
                        {editingItemId === item.id && (
                          <div className="mt-2">
                            <RichTextEditor
                              content={editContent}
                              onSave={(html) => handleSaveItemContent(item.id, item.moduleId, html)}
                              placeholder="Start writing lesson content..."
                              autoSaveMs={2000}
                            />
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Add item form */}
                <div className="border border-dashed border-gray-300 rounded-lg p-3">
                  <h4 className="text-xs font-semibold text-gray-600 mb-2">Add Item</h4>
                  <form onSubmit={handleAddItem} className="space-y-2">
                    <div className="flex gap-2">
                      <select
                        value={addItemType}
                        onChange={(e) => setAddItemType(e.target.value as ModuleItem['type'] | '')}
                        className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                        required
                      >
                        <option value="">Type...</option>
                        <option value="PAGE">Page</option>
                        <option value="PDF">PDF</option>
                        <option value="LINK">Link</option>
                        <option value="ASSESSMENT">Assessment</option>
                      </select>
                      <input
                        type="text"
                        value={addItemTitle}
                        onChange={(e) => setAddItemTitle(e.target.value)}
                        placeholder="Item title"
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                        required
                      />
                    </div>
                    {addItemType === 'LINK' && (
                      <input
                        type="url"
                        value={addItemUrl}
                        onChange={(e) => setAddItemUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                        required
                      />
                    )}
                    {addItemType === 'PAGE' && (
                      <textarea
                        value={addItemContent}
                        onChange={(e) => setAddItemContent(e.target.value)}
                        placeholder="MDX content (optional, can edit later)"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg font-mono"
                        rows={3}
                      />
                    )}
                    <button
                      type="submit"
                      disabled={addingItem || !addItemType}
                      className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      {addingItem ? 'Adding...' : 'Add Item'}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="text-gray-400 text-center py-12">
                {course.modules.length === 0
                  ? 'Create a module to start adding content.'
                  : 'Select a module from the left.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Sources Tab ─── */}
      {activeTab === 'sources' && (
        <div className="max-w-4xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Source Documents</h3>
              <p className="text-sm text-gray-500">
                Upload reference materials for RAG-based content generation. Documents are chunked
                and indexed for retrieval.
              </p>
            </div>
            <label className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer disabled:opacity-50">
              {uploadingDoc ? 'Uploading...' : 'Upload Document'}
              <input
                type="file"
                accept=".txt,.md,.pdf,.docx"
                className="hidden"
                disabled={uploadingDoc}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleDocUpload(file);
                }}
              />
            </label>
          </div>

          {loadingDocs ? (
            <p className="text-gray-400">Loading documents...</p>
          ) : documents.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
              <p className="text-gray-500 mb-2">No source documents yet</p>
              <p className="text-sm text-gray-400">
                Upload PDFs, text, or markdown files to use as source material for AI-generated
                content.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {doc.title}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {doc.mimeType.split('/')[1]?.toUpperCase() || 'FILE'}
                      </span>
                      {doc.indexedAt ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                          {doc.chunkCount} chunks
                        </span>
                      ) : doc.errorMessage ? (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700"
                          title={doc.errorMessage}
                        >
                          Error
                        </span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 animate-pulse">
                          {doc.processingStatus || 'Processing...'}
                          {doc.processingPct != null && ` ${doc.processingPct}%`}
                        </span>
                      )}
                    </div>
                    {/* Progress bar while processing */}
                    {!doc.indexedAt && !doc.errorMessage && doc.processingPct != null && (
                      <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-indigo-500 h-2 rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${doc.processingPct}%` }}
                        />
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      {doc.filename} &middot; {Math.round(doc.sizeBytes / 1024)}KB &middot; Uploaded
                      by {doc.uploadedBy.name} &middot;{' '}
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </p>
                    {doc.errorMessage && (
                      <p className="text-xs text-red-600 mt-1">{doc.errorMessage}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => handleRechunk(doc.id)}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                      title="Re-chunk document"
                    >
                      Re-chunk
                    </button>
                    <button
                      onClick={() => handleDeleteDoc(doc.id)}
                      className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Link to Course Studio */}
          <div className="mt-6 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
            <h4 className="text-sm font-semibold text-indigo-900 mb-1">AI Course Studio</h4>
            <p className="text-sm text-indigo-700 mb-3">
              Use your source documents to generate course content with RAG-powered AI. All content
              is generated as drafts for your review.
            </p>
            <button
              onClick={() => navigate(`/teacher/studio/${courseId}`)}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Open Course Studio
            </button>
          </div>
        </div>
      )}

      {/* Prompt Composer Modal */}
      {showPromptComposer && courseId && selectedModuleId && selectedModule && (
        <PromptComposerModal
          courseId={courseId}
          moduleId={selectedModuleId}
          moduleTitle={selectedModule.title}
          selectedPageIds={Array.from(selectedPageIds)}
          selectedPageTitles={Array.from(selectedPageIds).map(
            (id) => selectedModule.items.find((i) => i.id === id)?.title || id,
          )}
          initialSourceIds={selectedSourceIds}
          onClose={() => setShowPromptComposer(false)}
          onGenerate={handleAIGenerate}
        />
      )}

      {/* ─── Settings Tab ─── */}
      {activeTab === 'settings' && (
        <div className="max-w-md space-y-4">
          <button
            onClick={handleDuplicate}
            className="w-full px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-left"
          >
            Duplicate Course
          </button>
          <button
            onClick={handleArchive}
            className="w-full px-4 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors text-left"
          >
            Archive Course
          </button>
        </div>
      )}
    </div>
  );
}
