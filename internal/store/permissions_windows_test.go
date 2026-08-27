//go:build windows

package store

import (
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

// prepareSecureDatabase 曾经把 BuildSecurityDescriptor 生成的 SD 通过
// SECURITY_ATTRIBUTES 传给 CreateFile。该 SD 即使没有 audit entry 也会置
// SE_SACL_PRESENT（control 0x8014，SACL 指针为 NULL），内核因此尝试写 SACL，
// 需要已启用的 SeSecurityPrivilege：普通用户没有，提权后默认也是 disabled，
// 于是任何 Windows 用户都拿到 ERROR_PRIVILEGE_NOT_HELD，daemon 完全无法启动。
// 这里断言首次创建能成功落盘，并且拿到 protected、只含当前用户一条 ACE 的 DACL。
func TestPrepareSecureDatabaseCreatesOwnerOnlyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "daemon.db")

	if err := prepareSecureDatabase(path); err != nil {
		t.Fatalf("prepareSecureDatabase: %v", err)
	}

	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatalf("GetNamedSecurityInfo: %v", err)
	}
	control, _, err := sd.Control()
	if err != nil {
		t.Fatalf("read security descriptor control: %v", err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		t.Errorf("DACL 不是 protected（control=0x%04x），父目录继承的 ACE 仍会生效", control)
	}

	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatalf("GetTokenUser: %v", err)
	}
	sddl := sd.String()
	dacl := sddl[strings.Index(sddl, "D:"):]
	if got := strings.Count(dacl, "("); got != 1 {
		t.Errorf("DACL ACE 数量 = %d，期望 1（仅当前用户）：%s", got, dacl)
	}
	if !strings.Contains(dacl, user.User.Sid.String()) {
		t.Errorf("DACL 未授予当前用户：%s", dacl)
	}
}

// prepareSecureDatabase 在已存在的数据库上必须幂等——daemon 每次启动都会调用它。
func TestPrepareSecureDatabaseIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "daemon.db")

	if err := prepareSecureDatabase(path); err != nil {
		t.Fatalf("first prepareSecureDatabase: %v", err)
	}
	if err := prepareSecureDatabase(path); err != nil {
		t.Fatalf("second prepareSecureDatabase: %v", err)
	}
}
