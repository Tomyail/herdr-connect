//go:build windows

package store

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func prepareSecureDatabase(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("创建数据库目录: %w", err)
	}
	acl, err := ownerOnlyACL()
	if err != nil {
		return err
	}
	pathUTF16, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return fmt.Errorf("编码数据库路径: %w", err)
	}
	// 这里不能传 SECURITY_ATTRIBUTES：能拿到的 SECURITY_DESCRIPTOR 都会带
	// SE_SACL_PRESENT，内核随即要求已启用的 SeSecurityPrivilege（普通用户没有，
	// 提权后也只是 present 而非 enabled），必然 ERROR_PRIVILEGE_NOT_HELD。
	// 先普通创建，再由 setOwnerOnlyACL 施加 protected owner-only DACL。
	handle, err := windows.CreateFile(
		pathUTF16,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_ALWAYS,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		return fmt.Errorf("创建 owner-only 数据库文件: %w", err)
	}
	if err := windows.CloseHandle(handle); err != nil {
		return fmt.Errorf("关闭预创建数据库文件: %w", err)
	}
	return setOwnerOnlyACL(path, acl)
}

func secureSQLiteFiles(path string) error {
	acl, err := ownerOnlyACL()
	if err != nil {
		return err
	}
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return fmt.Errorf("读取 SQLite 文件: %w", err)
		}
		if err := setOwnerOnlyACL(candidate, acl); err != nil {
			return err
		}
	}
	return nil
}

// ownerOnlyACL 只构造 DACL，不再构造 SECURITY_DESCRIPTOR：owner 字段对
// 文件访问控制没有实际作用（创建者本来就是 owner），而
// BuildSecurityDescriptor 生成的 SD 会带上 SE_SACL_PRESENT，任何把它交给
// 内核的路径都会要求 SeSecurityPrivilege。
func ownerOnlyACL() (*windows.ACL, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, fmt.Errorf("读取当前 Windows 所有者 SID: %w", err)
	}
	entries := []windows.EXPLICIT_ACCESS{{
		AccessPermissions: windows.GENERIC_ALL,
		AccessMode:        windows.GRANT_ACCESS,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_USER,
			TrusteeValue: windows.TrusteeValueFromSID(user.User.Sid),
		},
	}}
	acl, err := windows.ACLFromEntries(entries, nil)
	if err != nil {
		return nil, fmt.Errorf("构造 owner-only Windows ACL: %w", err)
	}
	return acl, nil
}

func setOwnerOnlyACL(path string, acl *windows.ACL) error {
	if err := windows.SetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil,
		nil,
		acl,
		nil,
	); err != nil {
		return fmt.Errorf("设置 owner-only Windows ACL: %w", err)
	}
	return nil
}
