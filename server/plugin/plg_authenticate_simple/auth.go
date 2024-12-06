package plg_authenticate_simple

import (
	"fmt"
	"net/http"

	. "github.com/mickael-kerjean/filestash/server/common"

	"golang.org/x/crypto/bcrypt"
)

type SimpleAuth struct{}

func (this SimpleAuth) Setup() Form {
	nUsers := 0
	aUsers := 0
	if users, err := getUsers(); err == nil {
		nUsers = len(users)
		for i := range users {
			if users[i].Disabled == false {
				aUsers += 1
			}
		}
	}

	return Form{
		Elmnts: []FormElement{
			{
				Name: "banner",
				Type: "hidden",
				Description: fmt.Sprintf(`Manage your team members and their account permissions by visiting [/admin/simple-user-management](/admin/simple-user-management).
<pre>
STATS:
┌─────────────┐   ┌──────────────┐
│ TOTAL USERS │   │ ACTIVE USERS │
|    %.4d     │   |     %.4d     │
└─────────────┘   └──────────────┘

MANAGEMENT GUI: <a href="/admin/simple-user-management">/admin/simple-user-management</a>
EMAIL SERVER  : %t
</pre>`, nUsers, aUsers, isEmailSetup()),
			},
			{
				Name:  "type",
				Type:  "hidden",
				Value: "simple",
			},
			{
				Name: "notification_subject",
				Type: "text",
			},
			{
				Name: "notification_body",
				Type: "long_text",
				Placeholder: `Hello,

Your account to Filestash was created by an administrator. You can access
it via http://demo.filestash.app.

Your password is: {{ .password }}
The roles assigned to you: {{ .role }}

Cheers!`,
			},
			{
				Name: "db",
				Type: "hidden",
			},
		},
	}
}

func (this SimpleAuth) EntryPoint(idpParams map[string]string, req *http.Request, res http.ResponseWriter) error {
	getFlash := func() string {
		c, err := req.Cookie("flash")
		if err != nil {
			return ""
		}
		http.SetCookie(res, &http.Cookie{
			Name:   "flash",
			MaxAge: -1,
			Path:   "/",
		})
		return fmt.Sprintf(`<p class="flash">%s</p>`, c.Value)
	}
	res.Header().Set("Content-Type", "text/html; charset=utf-8")
	res.WriteHeader(http.StatusOK)
	res.Write([]byte(Page(`
      <form action="` + WithBase("/api/session/auth/") + `" method="post" class="component_middleware">
        <label>
          <input type="text" name="email" value="" placeholder="Email" />
        </label>
        <label>
          <input type="password" name="password" value="" placeholder="Password" />
        </label>
        <button>CONNECT</button>
        ` + getFlash() + `
        <style>
          .flash{ color: #f26d6d; font-weight: bold; }
          form { padding-top: 10vh; }
        </style>
      </form>`)))
	return nil
}

func (this SimpleAuth) Callback(formData map[string]string, idpParams map[string]string, res http.ResponseWriter) (map[string]string, error) {
	users, err := getUsers()
	if err != nil {
		return nil, err
	}
	for i := range users {
		if users[i].Email != formData["email"] {
			continue
		}
		if err = bcrypt.CompareHashAndPassword([]byte(users[i].Password), []byte(formData["password"])); err != nil {
			break
		}
		if users[i].Disabled == true {
			http.SetCookie(res, &http.Cookie{
				Name:   "flash",
				Value:  "Account is disabled",
				MaxAge: 1,
				Path:   "/",
			})
			Log.Warning("plg_authentication_simple::auth action=authenticate email=%s err=disabled", users[i].Email)
			return nil, ErrAuthenticationFailed
		}
		session := map[string]string{
			"user":     formData["email"],
			"password": formData["password"],
			"bcrypt":   users[i].Password,
			"role":     users[i].Role,
		}
		s := ""
		for k, v := range session {
			if k == "password" || k == "bcrypt" {
				v = "*****"
			}
			s += fmt.Sprintf("%s[%s] ", k, v)
		}
		Log.Debug("IDP Attributes => %s", s)
		return session, nil
	}

	http.SetCookie(res, &http.Cookie{
		Name:   "flash",
		Value:  "Inalid username or password",
		MaxAge: 1,
		Path:   "/",
	})
	return nil, ErrAuthenticationFailed
}
