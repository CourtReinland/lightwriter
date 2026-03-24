import { useState, useRef } from "react";
import { StorageService, type Project } from "../../services/storageService";
import { importFile } from "../../services/fileImporter";
import "./ProjectMenu.css";

interface ProjectMenuProps {
  currentProject: Project | null;
  onLoadProject: (project: Project) => void;
  onNewProject: (name: string, content?: string) => void;
  onClose: () => void;
}

export default function ProjectMenu({
  currentProject,
  onLoadProject,
  onNewProject,
  onClose,
}: ProjectMenuProps) {
  const [projects] = useState(() => StorageService.listProjects());
  const [newName, setNewName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleNew = () => {
    const name = newName.trim() || "Untitled";
    onNewProject(name);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError(null);

    try {
      const content = await importFile(file);
      const name = file.name.replace(/\.(fountain|fdx|celtx|txt)$/i, "");
      onNewProject(name, content);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete this project permanently?")) {
      StorageService.deleteProject(id);
      // Refresh — close and reopen would show updated list
      onClose();
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;

    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="project-menu-backdrop" onClick={onClose}>
      <div className="project-menu" onClick={(e) => e.stopPropagation()}>
        <div className="pm-header">
          <span className="pm-title">Projects</span>
          <button className="pm-close" onClick={onClose}>
            x
          </button>
        </div>

        {/* New project */}
        <div className="pm-section">
          <div className="pm-section-title">New Project</div>
          <div className="pm-new-row">
            <input
              className="pm-input"
              placeholder="Project name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleNew()}
              autoFocus
            />
            <button className="pm-btn primary" onClick={handleNew}>
              Create
            </button>
          </div>
        </div>

        {/* Import */}
        <div className="pm-section">
          <div className="pm-section-title">Import File</div>
          <button
            className="pm-btn import-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? "Importing..." : "Open .fountain / .fdx / .celtx"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".fountain,.fdx,.celtx,.txt,.pdf"
            style={{ display: "none" }}
            onChange={handleImport}
          />
          {importError && <div className="pm-error">{importError}</div>}
        </div>

        {/* Project list */}
        {projects.length > 0 && (
          <div className="pm-section">
            <div className="pm-section-title">
              Saved Projects ({projects.length})
            </div>
            <div className="pm-project-list">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className={`pm-project ${p.id === currentProject?.id ? "active" : ""}`}
                  onClick={() => {
                    const full = StorageService.getProject(p.id);
                    if (full) onLoadProject(full);
                  }}
                >
                  <div className="pm-project-info">
                    <span className="pm-project-name">{p.name}</span>
                    <span className="pm-project-meta">
                      {p.targetPages}pp | {formatDate(p.updatedAt)}
                    </span>
                  </div>
                  <button
                    className="pm-delete"
                    onClick={(e) => handleDelete(p.id, e)}
                    title="Delete project"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
