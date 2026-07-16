//go:build windows

package store

import (
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

func prepareSecureDatabase(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("创建数据库目录: %w", err)
	}
	sd, acl, err := ownerOnlySecurity()
	if err != nil {
		return err
	}
	pathUTF16, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return fmt.Errorf("编码数据库路径: %w", err)
	}
	sa := &windows.SecurityAttributes{
		Length:             uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		SecurityDescriptor: sd,
	}
	handle, err := windows.CreateFile(
		pathUTF16,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		sa,
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
	_, acl, err := ownerOnlySecurity()
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

func ownerOnlySecurity() (*windows.SECURITY_DESCRIPTOR, *windows.ACL, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, nil, fmt.Errorf("读取当前 Windows 所有者 SID: %w", err)
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
		return nil, nil, fmt.Errorf("构造 owner-only Windows ACL: %w", err)
	}
	owner := &windows.TRUSTEE{
		TrusteeForm:  windows.TRUSTEE_IS_SID,
		TrusteeType:  windows.TRUSTEE_IS_USER,
		TrusteeValue: windows.TrusteeValueFromSID(user.User.Sid),
	}
	sd, err := windows.BuildSecurityDescriptor(owner, nil, entries, nil, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("构造 owner-only Windows security descriptor: %w", err)
	}
	return sd, acl, nil
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
