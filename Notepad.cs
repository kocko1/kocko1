using System;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal sealed class PlainTextEditor : RichTextBox
{
    protected override void WndProc(ref Message message)
    {
        // Keep pasted content plain, including the native context menu's Paste.
        if (message.Msg == 0x302)
        {
            if (Clipboard.ContainsText()) SelectedText = Clipboard.GetText();
            return;
        }
        base.WndProc(ref message);
    }
}

internal sealed class NotepadWindow : Form
{
    private readonly PlainTextEditor editor = new PlainTextEditor();
    private readonly ToolStripStatusLabel position = new ToolStripStatusLabel();
    private readonly ToolStripStatusLabel fileStatus = new ToolStripStatusLabel();
    private string filePath;
    private string savedText = "";
    private Encoding encoding = new UTF8Encoding(false, true);
    private string newline = Environment.NewLine;
    private Form findWindow;
    private TextBox findInput;

    public NotepadWindow(string initialPath)
    {
        Text = "Untitled - Simple Notepad";
        Size = new Size(940, 680);
        MinimumSize = new Size(520, 340);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10);
        Icon = SystemIcons.Application;

        var menu = new MenuStrip();
        var file = new ToolStripMenuItem("&File");
        file.DropDownItems.Add(Item("&New", Keys.Control | Keys.N, NewFile));
        file.DropDownItems.Add(Item("&Open...", Keys.Control | Keys.O, OpenFile));
        file.DropDownItems.Add(new ToolStripSeparator());
        file.DropDownItems.Add(Item("&Save", Keys.Control | Keys.S, delegate { SaveFile(false); }));
        file.DropDownItems.Add(Item("Save &As...", Keys.Control | Keys.Shift | Keys.S, delegate { SaveFile(true); }));
        file.DropDownItems.Add(new ToolStripSeparator());
        file.DropDownItems.Add(Item("E&xit", Keys.Alt | Keys.F4, Close));

        var edit = new ToolStripMenuItem("&Edit");
        edit.DropDownItems.Add(Item("&Undo", Keys.Control | Keys.Z, delegate { editor.Undo(); }));
        edit.DropDownItems.Add(Item("&Redo", Keys.Control | Keys.Y, delegate { editor.Redo(); }));
        edit.DropDownItems.Add(new ToolStripSeparator());
        edit.DropDownItems.Add(Item("Cu&t", Keys.Control | Keys.X, editor.Cut));
        edit.DropDownItems.Add(Item("&Copy", Keys.Control | Keys.C, editor.Copy));
        edit.DropDownItems.Add(Item("&Paste", Keys.Control | Keys.V, PasteText));
        edit.DropDownItems.Add(Item("Select &All", Keys.Control | Keys.A, editor.SelectAll));
        edit.DropDownItems.Add(new ToolStripSeparator());
        edit.DropDownItems.Add(Item("&Find...", Keys.Control | Keys.F, ShowFind));
        edit.DropDownItems.Add(Item("Time / &Date", Keys.F5, delegate { editor.SelectedText = DateTime.Now.ToString("g"); }));

        var view = new ToolStripMenuItem("&View");
        var wrap = new ToolStripMenuItem("&Word wrap") { Checked = true, CheckOnClick = true };
        wrap.CheckedChanged += delegate { editor.WordWrap = wrap.Checked; };
        view.DropDownItems.Add(wrap);
        view.DropDownItems.Add(Item("&Font...", Keys.None, delegate {
            using (var dialog = new FontDialog { Font = editor.Font, ShowEffects = false })
                if (dialog.ShowDialog(this) == DialogResult.OK) editor.Font = dialog.Font;
        }));
        menu.Items.AddRange(new ToolStripItem[] { file, edit, view });
        MainMenuStrip = menu;

        var toolbar = new ToolStrip { GripStyle = ToolStripGripStyle.Hidden, Padding = new Padding(8, 4, 8, 4) };
        toolbar.Items.Add(Button("New", "New (Ctrl+N)", NewFile));
        toolbar.Items.Add(Button("Open", "Open (Ctrl+O)", OpenFile));
        toolbar.Items.Add(Button("Save", "Save (Ctrl+S)", delegate { SaveFile(false); }));
        toolbar.Items.Add(new ToolStripSeparator());
        toolbar.Items.Add(Button("Find", "Find (Ctrl+F)", ShowFind));

        editor.Dock = DockStyle.Fill;
        editor.BorderStyle = BorderStyle.None;
        editor.Font = new Font("Consolas", 12);
        editor.BackColor = Color.FromArgb(253, 253, 250);
        editor.ForeColor = Color.FromArgb(32, 37, 43);
        editor.AcceptsTab = true;
        editor.DetectUrls = false;
        editor.WordWrap = true;
        editor.HideSelection = false;
        editor.EnableAutoDragDrop = false;
        editor.AccessibleName = "Note editor";
        editor.TextChanged += delegate { UpdateStatus(); };
        editor.SelectionChanged += delegate { UpdateStatus(); };
        var context = new ContextMenuStrip();
        context.Items.Add("Undo", null, delegate { editor.Undo(); });
        context.Items.Add(new ToolStripSeparator());
        context.Items.Add("Cut", null, delegate { editor.Cut(); });
        context.Items.Add("Copy", null, delegate { editor.Copy(); });
        context.Items.Add("Paste", null, delegate { PasteText(); });
        context.Items.Add("Select All", null, delegate { editor.SelectAll(); });
        editor.ContextMenuStrip = context;

        var sheet = new Panel { Dock = DockStyle.Fill, Padding = new Padding(18), BackColor = editor.BackColor };
        sheet.Controls.Add(editor);
        var status = new StatusStrip { SizingGrip = true };
        fileStatus.Spring = true;
        fileStatus.TextAlign = ContentAlignment.MiddleLeft;
        status.Items.Add(fileStatus);
        status.Items.Add(position);
        Controls.Add(sheet);
        Controls.Add(status);
        Controls.Add(toolbar);
        Controls.Add(menu);
        FormClosing += delegate(object sender, FormClosingEventArgs e) { e.Cancel = !ConfirmSave(); };
        Shown += delegate { if (!String.IsNullOrEmpty(initialPath)) LoadFile(initialPath); editor.Focus(); };
        UpdateStatus();
    }

    private ToolStripMenuItem Item(string label, Keys shortcut, Action action)
    {
        var item = new ToolStripMenuItem(label) { ShortcutKeys = shortcut };
        item.Click += delegate { action(); };
        return item;
    }

    private ToolStripButton Button(string label, string hint, Action action)
    {
        var button = new ToolStripButton(label) { ToolTipText = hint, Padding = new Padding(7, 2, 7, 2) };
        button.Click += delegate { action(); editor.Focus(); };
        return button;
    }

    private bool Dirty { get { return editor.Text != savedText; } }

    private void UpdateStatus()
    {
        Text = (Dirty ? "*" : "") + (filePath == null ? "Untitled" : Path.GetFileName(filePath)) + " - Simple Notepad";
        int line = editor.GetLineFromCharIndex(editor.SelectionStart);
        int column = editor.SelectionStart - editor.GetFirstCharIndexFromLine(line);
        position.Text = String.Format("Ln {0}, Col {1}   |   {2:N0} characters", line + 1, column + 1, editor.TextLength);
        fileStatus.Text = (Dirty ? "Unsaved changes" : "Saved") + "   |   " + encoding.WebName.ToUpperInvariant();
        fileStatus.ToolTipText = filePath ?? "New document";
    }

    private bool ConfirmSave()
    {
        if (!Dirty) return true;
        var choice = MessageBox.Show(this, "Save changes to " + (filePath == null ? "Untitled" : Path.GetFileName(filePath)) + "?",
            "Unsaved changes", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);
        return choice == DialogResult.No || (choice == DialogResult.Yes && SaveFile(false));
    }

    private void NewFile()
    {
        if (!ConfirmSave()) return;
        filePath = null;
        encoding = new UTF8Encoding(false, true);
        newline = Environment.NewLine;
        savedText = "";
        editor.Clear();
        editor.ClearUndo();
        UpdateStatus();
        editor.Focus();
    }

    private void OpenFile()
    {
        if (!ConfirmSave()) return;
        using (var dialog = new OpenFileDialog { Filter = "Text files (*.txt)|*.txt|All files (*.*)|*.*", CheckFileExists = true })
            if (dialog.ShowDialog(this) == DialogResult.OK) LoadFile(dialog.FileName);
    }

    private void LoadFile(string path)
    {
        try
        {
            string content;
            Encoding detected;
            using (var reader = new StreamReader(path, new UTF8Encoding(false, true), true))
            {
                content = reader.ReadToEnd();
                detected = reader.CurrentEncoding;
            }
            editor.Text = content;
            filePath = Path.GetFullPath(path);
            encoding = detected;
            newline = content.Contains("\r\n") ? "\r\n" : (content.Contains("\n") ? "\n" : Environment.NewLine);
            savedText = editor.Text;
            editor.ClearUndo();
            editor.SelectionStart = 0;
            UpdateStatus();
            editor.Focus();
        }
        catch (Exception error) { ShowError("open this file", error); }
    }

    private bool SaveFile(bool saveAs)
    {
        string destination = filePath;
        if (saveAs || destination == null)
        {
            using (var dialog = new SaveFileDialog {
                Filter = "Text files (*.txt)|*.txt|All files (*.*)|*.*", DefaultExt = "txt", AddExtension = true,
                FileName = filePath == null ? "Untitled.txt" : Path.GetFileName(filePath),
                InitialDirectory = filePath == null ? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) : Path.GetDirectoryName(filePath)
            })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return false;
                destination = dialog.FileName;
            }
        }
        string temporary = null;
        try
        {
            destination = Path.GetFullPath(destination);
            temporary = Path.Combine(Path.GetDirectoryName(destination), ".notepad-" + Guid.NewGuid().ToString("N") + ".tmp");
            string content = editor.Text.Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", newline);
            File.WriteAllText(temporary, content, encoding);
            if (File.Exists(destination)) File.Replace(temporary, destination, null);
            else File.Move(temporary, destination);
            filePath = destination;
            savedText = editor.Text;
            UpdateStatus();
            return true;
        }
        catch (Exception error) { ShowError("save this file", error); return false; }
        finally { if (temporary != null && File.Exists(temporary)) { try { File.Delete(temporary); } catch { } } }
    }

    private void PasteText()
    {
        try { if (Clipboard.ContainsText()) editor.SelectedText = Clipboard.GetText(); }
        catch (Exception error) { ShowError("paste from the clipboard", error); }
    }

    private void ShowFind()
    {
        if (findWindow != null && !findWindow.IsDisposed) { findWindow.Activate(); findInput.Focus(); return; }
        findWindow = new Form { Text = "Find", ClientSize = new Size(400, 116), FormBorderStyle = FormBorderStyle.FixedDialog,
            MinimizeBox = false, MaximizeBox = false, ShowInTaskbar = false, StartPosition = FormStartPosition.CenterParent, Font = Font };
        findWindow.Controls.Add(new Label { Text = "Find in your note:", Left = 14, Top = 12, AutoSize = true });
        findInput = new TextBox { Left = 14, Top = 35, Width = 370, Text = editor.SelectedText };
        var next = new Button { Text = "Find next", Left = 182, Top = 74, Width = 96 };
        var close = new Button { Text = "Close", Left = 288, Top = 74, Width = 96, DialogResult = DialogResult.Cancel };
        next.Click += delegate {
            if (findInput.Text.Length == 0) return;
            int start = Math.Min(editor.TextLength, editor.SelectionStart + editor.SelectionLength);
            int found = editor.Text.IndexOf(findInput.Text, start, StringComparison.CurrentCultureIgnoreCase);
            if (found < 0) found = editor.Text.IndexOf(findInput.Text, StringComparison.CurrentCultureIgnoreCase);
            if (found < 0) MessageBox.Show(findWindow, "No matches found.", "Find", MessageBoxButtons.OK, MessageBoxIcon.Information);
            else { editor.Select(found, findInput.Text.Length); editor.ScrollToCaret(); }
        };
        close.Click += delegate { findWindow.Close(); editor.Focus(); };
        findWindow.Controls.AddRange(new Control[] { findInput, next, close });
        findWindow.AcceptButton = next;
        findWindow.CancelButton = close;
        findWindow.Show(this);
        findInput.SelectAll();
        findInput.Focus();
    }

    private void ShowError(string action, Exception error)
    {
        MessageBox.Show(this, "Couldn't " + action + ".\n\n" + error.Message, "Simple Notepad", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new NotepadWindow(args.Length > 0 ? args[0] : null));
    }
}
